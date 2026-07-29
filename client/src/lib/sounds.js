/**
 * Notification / call audio, synthesized with the Web Audio API.
 *
 * Tones are generated rather than shipped as assets so there are no binary files
 * to host, no extra network round-trip before the first ping, and the ringtone can
 * loop indefinitely without gaps.
 *
 * Browsers block audio until the user has interacted with the page, so unlock()
 * is wired to the first pointer/key event and every play call is a no-op until
 * then (a blocked play must never throw into a socket handler).
 */
import { useAuth } from '../store/useAuth';

let ctx = null;
let unlocked = false;

function audioCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}

/** Resume the audio context. Safe to call repeatedly. */
export function unlockAudio() {
  const ac = audioCtx();
  if (!ac) return;
  unlocked = true;
  if (ac.state === 'suspended') ac.resume().catch(() => {});
}

/** Attach one-shot listeners so the first user gesture enables sound. */
export function initAudioUnlock() {
  if (typeof window === 'undefined') return;
  const on = () => unlockAudio();
  ['pointerdown', 'keydown', 'touchstart'].forEach((e) =>
    window.addEventListener(e, on, { once: true, passive: true })
  );
}

/** Has the user muted sounds in Settings → Notifications? */
function soundsEnabled() {
  return useAuth.getState().user?.settings?.notifications?.sound !== false;
}

/**
 * Play one enveloped sine tone. The gain ramp matters: a raw start/stop on an
 * oscillator produces an audible click at both ends.
 */
function tone({ freq, start = 0, duration = 0.18, gain = 0.14, type = 'sine' }) {
  const ac = audioCtx();
  if (!ac) return;
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const vol = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  vol.gain.setValueAtTime(0.0001, t0);
  vol.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  vol.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(vol).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

function canPlay() {
  return unlocked && soundsEnabled() && audioCtx();
}

/** Incoming message: a soft two-note rising ping. */
export function playMessageTone() {
  if (!canPlay()) return;
  unlockAudio();
  tone({ freq: 784, duration: 0.13, gain: 0.1 });
  tone({ freq: 1175, start: 0.1, duration: 0.2, gain: 0.09 });
}

// ── Call ringing ────────────────────────────────────────────────
// Both ring patterns are interval-driven rather than a looping buffer so they can
// be stopped instantly at any point in the cycle.

let ringTimer = null;

function stopRing() {
  if (ringTimer) clearInterval(ringTimer);
  ringTimer = null;
}

/**
 * Incoming call: a repeating double-buzz until stopRingtone() is called.
 * Only one ring pattern can be active at a time.
 */
export function startRingtone() {
  stopRing();
  if (!canPlay()) return;
  unlockAudio();
  const burst = () => {
    tone({ freq: 880, duration: 0.4, gain: 0.16, type: 'triangle' });
    tone({ freq: 660, start: 0.45, duration: 0.4, gain: 0.16, type: 'triangle' });
  };
  burst();
  ringTimer = setInterval(burst, 2000);
}

/** Outgoing call: a slower, quieter ringback so you know it's ringing. */
export function startRingback() {
  stopRing();
  if (!canPlay()) return;
  unlockAudio();
  const burst = () => tone({ freq: 440, duration: 0.9, gain: 0.07, type: 'sine' });
  burst();
  ringTimer = setInterval(burst, 3000);
}

/** Stop whichever ring pattern is playing. Always safe to call. */
export function stopRingtone() {
  stopRing();
}

/** Call ended / rejected: a short descending pair. */
export function playCallEndTone() {
  stopRing();
  if (!canPlay()) return;
  tone({ freq: 520, duration: 0.14, gain: 0.09 });
  tone({ freq: 390, start: 0.13, duration: 0.22, gain: 0.09 });
}
