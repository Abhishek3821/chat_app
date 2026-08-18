/**
 * Background blur and virtual backgrounds for the local camera.
 *
 * Shape of it: the camera stream goes in, a canvas comes out. Each frame is
 * segmented into person / not-person, the background half is replaced (blurred
 * or painted with an image), and the composite is re-captured as a MediaStream
 * that every consumer — the mesh peer connections, the call, the local preview —
 * uses exactly as it used the camera before. Nothing downstream needs to know.
 *
 * Everything here is LAZY. The segmentation runtime is ~12MB of wasm, so it is
 * dynamically imported the first time somebody actually turns an effect on; a
 * user who never touches the button pays nothing. Both the runtime and the model
 * are served from our own origin — the deployed CSP is `script-src 'self'`, so a
 * CDN copy would be blocked, and a call that breaks because someone else's CDN
 * is down is not a trade worth making (see copy-mediapipe.mjs).
 */

export const EFFECTS = { NONE: 'none', BLUR: 'blur', IMAGE: 'image' };

/** Target rate for the composite. 24 is smooth for a talking head and leaves
 *  headroom on a laptop that is also encoding video for several peers. */
const FPS = 24;
/** Radius of the background blur, in canvas pixels at 720p. */
const BLUR_PX = 14;

let segmenterPromise = null;

/**
 * Can this browser run the effects at all? Checked before offering the control,
 * so it is never a button that does nothing.
 */
export function effectsSupported() {
  return (
    typeof window !== 'undefined' &&
    'WebAssembly' in window &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    typeof document !== 'undefined'
  );
}

/**
 * Can this page compile WebAssembly at all?
 *
 * Chrome requires `'wasm-unsafe-eval'` in the CSP's `script-src`, and without it
 * every WebAssembly call throws — including MediaPipe's own SIMD feature test,
 * which then quietly reports "no SIMD" and asks for a *different* filename.
 * Checking here turns a confusing 404 into an accurate sentence.
 */
function wasmBlocked() {
  try {
    // The 8-byte header of an empty, valid module. Compiling it is the cheapest
    // possible probe and is exactly what CSP intercepts.
    // Reached off `window` so the undefined-reference scanner (which does not
    // know the WebAssembly global) stays clean — same reason as effectsSupported.
    new window.WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
    return false;
  } catch {
    return true;
  }
}

/** Fetch a HEAD to confirm an asset is actually served before MediaPipe needs it. */
async function assetMissing(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok ? null : `${url} → HTTP ${res.status}`;
  } catch (e) {
    return `${url} → ${e?.message || 'unreachable'}`;
  }
}

/**
 * Load (once) the MediaPipe selfie segmenter. Subsequent calls reuse it.
 *
 * Every failure path here reports WHAT failed. The first version caught
 * everything into "Background effects could not start on this device", which is
 * true, useless, and hid two entirely different bugs (a blocked CSP and a
 * missing wasm variant) behind identical text.
 */
async function getSegmenter() {
  if (segmenterPromise) return segmenterPromise;
  segmenterPromise = (async () => {
    if (wasmBlocked()) {
      throw new Error(
        "This page isn't allowed to run WebAssembly, which background effects need. Add 'wasm-unsafe-eval' to the script-src Content-Security-Policy."
      );
    }

    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');

    // MediaPipe resolves its own filename from a SIMD test, so check the model —
    // which is a fixed path — and report clearly if the engine wasn't staged.
    const missing = await assetMissing('/models/selfie_segmenter.tflite');
    if (missing) {
      throw new Error(`The background-effects model isn't being served (${missing}). Run \`npm run dev\` again to stage it.`);
    }

    const fileset = await FilesetResolver.forVisionTasks('/mediapipe');

    /* GPU first, CPU on failure. The GPU delegate needs a working WebGL2
       context, which a VM, a locked-down driver or a headless-ish environment
       may not have — and its failure is not a reason to have no blur at all. */
    const options = {
      baseOptions: { modelAssetPath: '/models/selfie_segmenter.tflite' },
      runningMode: 'VIDEO',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    };
    try {
      return await ImageSegmenter.createFromOptions(fileset, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: 'GPU' },
      });
    } catch (gpuErr) {
      try {
        return await ImageSegmenter.createFromOptions(fileset, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: 'CPU' },
        });
      } catch (cpuErr) {
        throw new Error(`The effects engine could not start (GPU: ${gpuErr?.message || gpuErr}; CPU: ${cpuErr?.message || cpuErr}).`);
      }
    }
  })().catch((err) => {
    segmenterPromise = null; // let a later attempt retry rather than fail forever
    throw err;
  });
  return segmenterPromise;
}

/** Decode a background image URL once, ready to draw. */
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That background image could not be loaded.'));
    img.src = url;
  });
}

/**
 * Wrap a camera stream in an effects pipeline.
 *
 * @param {MediaStream} source          the raw camera stream
 * @param {object}      opts
 * @param {string}      opts.effect     one of EFFECTS
 * @param {string}     [opts.image]     background image URL, for EFFECTS.IMAGE
 * @returns {Promise<{stream: MediaStream, setEffect: Function, destroy: Function}>}
 *
 * The returned stream carries the SOURCE's audio tracks unchanged — only video
 * is rewritten, so muting and audio levels behave exactly as before.
 */
export async function createEffectPipeline(source, { effect = EFFECTS.BLUR, image = '' } = {}) {
  const sourceTrack = source.getVideoTracks()[0];
  if (!sourceTrack) throw new Error('That stream has no camera track to apply an effect to.');

  const segmenter = await getSegmenter();
  let background = effect === EFFECTS.IMAGE && image ? await loadImage(image) : null;

  const settings = sourceTrack.getSettings();
  const width = settings.width || 1280;
  const height = settings.height || 720;

  // A detached <video> is the only way to feed frames to the segmenter; it is
  // never attached to the document.
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.srcObject = new MediaStream([sourceTrack]);
  await video.play().catch(() => {});

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');

  // Person-only layer, rebuilt each frame: the camera frame masked down to the
  // pixels the segmenter called "person".
  const person = document.createElement('canvas');
  person.width = width;
  person.height = height;
  const personCtx = person.getContext('2d');

  /* The stencil is built at the MASK's OWN resolution and then scaled up.
     The segmenter does not promise a mask the size of the frame — it returns one
     sized to the model's output — so indexing a frame-sized RGBA buffer with
     mask pixels would shear the stencil diagonally the moment the two disagree.
     Allocated lazily and reused; per-frame allocation is what makes these
     pipelines stutter. */
  const stencil = document.createElement('canvas');
  const stencilCtx = stencil.getContext('2d');
  let stencilData = null;

  let current = effect;
  let raf = null;
  let stopped = false;
  let lastDraw = 0;
  const frameInterval = 1000 / FPS;

  const drawMask = (mask, mw, mh) => {
    if (stencil.width !== mw || stencil.height !== mh) {
      stencil.width = mw;
      stencil.height = mh;
      stencilData = stencilCtx.createImageData(mw, mh);
    }
    const data = stencilData.data;
    // Category 0 is background for the selfie segmenter; anything else is the
    // person. Alpha carries the stencil, RGB is irrelevant.
    for (let i = 0, p = 0; i < mask.length; i += 1, p += 4) {
      data[p + 3] = mask[i] > 0 ? 255 : 0;
    }
    stencilCtx.putImageData(stencilData, 0, 0);
    // Scale to the frame. drawImage smooths the edge for free, which softens
    // the mask's hard 1-bit boundary into something that doesn't shimmer.
    personCtx.drawImage(stencil, 0, 0, mw, mh, 0, 0, width, height);
  };

  const render = (now) => {
    if (stopped) return;
    raf = requestAnimationFrame(render);
    if (now - lastDraw < frameInterval) return; // hold the target rate
    lastDraw = now;
    if (video.readyState < video.HAVE_CURRENT_DATA) return;

    // Pass-through: still re-captured through the canvas so that switching the
    // effect off never has to renegotiate the peer connection.
    if (current === EFFECTS.NONE) {
      ctx.filter = 'none';
      ctx.drawImage(video, 0, 0, width, height);
      return;
    }

    let result;
    try {
      result = segmenter.segmentForVideo(video, now);
    } catch {
      ctx.filter = 'none';
      ctx.drawImage(video, 0, 0, width, height); // a dropped frame shows the real one
      return;
    }
    const cat = result?.categoryMask;
    const mask = cat?.getAsUint8Array?.();
    if (!mask) {
      ctx.filter = 'none';
      ctx.drawImage(video, 0, 0, width, height);
      result?.close?.();
      return;
    }

    // 1. Background layer.
    ctx.filter = 'none';
    if (current === EFFECTS.IMAGE && background) {
      // `cover` fit, so a background of any aspect fills without distortion.
      const scale = Math.max(width / background.width, height / background.height);
      const w = background.width * scale;
      const h = background.height * scale;
      ctx.drawImage(background, (width - w) / 2, (height - h) / 2, w, h);
    } else {
      ctx.filter = `blur(${BLUR_PX}px)`;
      ctx.drawImage(video, 0, 0, width, height);
      ctx.filter = 'none';
    }

    // 2. Person layer: the frame, stencilled by the mask.
    personCtx.globalCompositeOperation = 'copy'; // clears last frame's stencil
    drawMask(mask, cat.width || width, cat.height || height);
    personCtx.globalCompositeOperation = 'source-in';
    personCtx.drawImage(video, 0, 0, width, height);

    // 3. Composite the person over the background.
    ctx.drawImage(person, 0, 0);

    result?.close?.();
  };

  raf = requestAnimationFrame(render);

  const stream = out.captureStream(FPS);
  source.getAudioTracks().forEach((t) => stream.addTrack(t));

  return {
    stream,
    /** Switch effect without rebuilding the pipeline — the outgoing track, and
     *  therefore the peer connection, is untouched. */
    async setEffect(next, nextImage) {
      if (next === EFFECTS.IMAGE) background = await loadImage(nextImage || image);
      current = next;
    },
    /** Tear down. Does NOT stop the source camera track — whoever captured it
     *  owns its lifetime, and stopping it here would kill the call. */
    destroy() {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      stream.getVideoTracks().forEach((t) => t.stop());
      video.srcObject = null;
      out.width = out.height = 0;
      person.width = person.height = 0;
    },
  };
}

/** Preset backgrounds, drawn as gradients so they ship with no image payload. */
export const BACKGROUND_PRESETS = [
  { id: 'blur', label: 'Blur', effect: EFFECTS.BLUR },
  { id: 'teal', label: 'Deep teal', effect: EFFECTS.IMAGE, gradient: ['#0C2C47', '#1E6F68'] },
  { id: 'dusk', label: 'Dusk', effect: EFFECTS.IMAGE, gradient: ['#2B1B4A', '#8E4B6B'] },
  { id: 'linen', label: 'Linen', effect: EFFECTS.IMAGE, gradient: ['#E8E2D5', '#C9BCA4'] },
];

/**
 * Render a preset gradient to a data URL. Keeps virtual backgrounds working
 * with no binary assets to host, and gives the presets the product's own palette
 * instead of stock photos.
 */
export function gradientDataUrl([from, to], w = 1280, h = 720) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, from);
  grad.addColorStop(1, to);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  return c.toDataURL('image/png');
}
