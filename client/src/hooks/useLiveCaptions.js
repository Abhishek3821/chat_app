import { useCallback, useEffect, useRef, useState } from 'react';

const getSocket = () => (typeof window !== 'undefined' ? window.__ccSocket : null);

const SpeechRecognitionImpl =
  typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

/** Chrome/Edge only — Safari, iOS and Firefox have no Web Speech API at all. */
export const captionsSupported = () => Boolean(SpeechRecognitionImpl);

// Interim results fire many times per second; coalesce so we don't flood the room.
const INTERIM_MIN_INTERVAL_MS = 300;
// Captions older than this are dropped from the overlay.
const LINE_TTL_MS = 6000;
// Restarting instantly after a failure spins a hot loop that burns CPU and never
// recovers. Back off, and give up after this many consecutive failures.
const RESTART_DELAY_MS = 400;
const MAX_CONSECUTIVE_FAILURES = 5;

/** Which SpeechRecognition errors are fatal, and what to tell the user.
 *  Anything not listed is transient ('no-speech', 'aborted') and just restarts. */
const FATAL_ERRORS = {
  'not-allowed': 'Microphone permission is needed for captions.',
  'service-not-allowed': 'This browser blocked speech recognition. Check your site permissions.',
  'audio-capture': 'No microphone available for captions — another app may be using it.',
  'language-not-supported': 'Live captions aren’t available for your browser language.',
};

/**
 * Live captions for a meeting.
 *
 * Each participant transcribes their OWN microphone locally and broadcasts the
 * text over the meeting socket. That means no server STT cost, it scales with
 * the room, and speaker attribution is free — a caption can only come from the
 * person who spoke it.
 *
 * The tricky part is not the recognition, it's keeping it alive: the browser
 * ends a recognition session on its own (on silence, or after roughly a minute),
 * so `onend` has to restart it for as long as captions are enabled. Without that
 * captions appear to work and then quietly stop.
 */
export function useLiveCaptions(meetingId, { myName = 'You', muted = false } = {}) {
  const [enabled, setEnabled] = useState(false);
  const [lines, setLines] = useState([]); // [{ id, name, text, final, at }]
  const [error, setError] = useState(null);

  const recogRef = useRef(null);
  const enabledRef = useRef(false); // read inside onend, where state would be stale
  const lastInterimRef = useRef(0);
  const seqRef = useRef(0);
  const failuresRef = useRef(0);
  const restartTimerRef = useRef(null);
  // Speech recognition opens its OWN mic capture, independent of the WebRTC track
  // that mute disables — so without this the room would keep receiving captions of
  // everything a "muted" person said. Read via ref so the live recogniser sees the
  // current value without being torn down and rebuilt on every mute toggle.
  const mutedRef = useRef(muted);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  const pushLine = useCallback((line) => {
    setLines((prev) => {
      // One live row per speaker: a speaker's interim text should update in place
      // rather than stack up a new row on every partial result.
      const withoutLive = prev.filter((l) => !(l.name === line.name && !l.final));
      return [...withoutLive, line].slice(-4);
    });
  }, []);

  // Expire old lines so the overlay doesn't accumulate.
  useEffect(() => {
    if (!lines.length) return undefined;
    const t = setInterval(() => {
      const cutoff = Date.now() - LINE_TTL_MS;
      setLines((prev) => prev.filter((l) => l.at > cutoff));
    }, 1000);
    return () => clearInterval(t);
  }, [lines.length]);

  // Captions from other participants.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onCaption = ({ name, text, final, at }) => {
      pushLine({ id: `c-${seqRef.current++}`, name: name || 'Someone', text, final: !!final, at: at || Date.now() });
    };
    socket.on('meeting:caption', onCaption);
    return () => socket.off('meeting:caption', onCaption);
  }, [pushLine]);

  const stop = useCallback(() => {
    enabledRef.current = false;
    setEnabled(false);
    clearTimeout(restartTimerRef.current); // or a queued restart revives it
    const r = recogRef.current;
    recogRef.current = null;
    if (r) {
      // Drop the restart handler BEFORE aborting, or onend will revive it.
      r.onend = null;
      r.onresult = null;
      r.onerror = null;
      try {
        r.abort();
      } catch {
        /* already dead */
      }
    }
  }, []);

  const start = useCallback(() => {
    if (!SpeechRecognitionImpl) {
      setError('Live captions need Chrome or Edge — this browser has no speech recognition.');
      return;
    }
    if (recogRef.current) return;

    const build = () => {
      const r = new SpeechRecognitionImpl();
      r.continuous = true;
      r.interimResults = true;
      r.lang = navigator.language || 'en-US';

      r.onresult = (ev) => {
        // Getting results at all means the recogniser is healthy again.
        failuresRef.current = 0;
        // Muted: transcribe nothing and broadcast nothing. Dropping the results
        // here (rather than not starting) keeps captions instant on unmute.
        if (mutedRef.current) return;
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
          const res = ev.results[i];
          const text = String(res[0]?.transcript || '').trim();
          if (!text) continue;
          if (res.isFinal) {
            getSocket()?.emit('meeting:caption', { meetingId, text, final: true });
            pushLine({ id: `me-${seqRef.current++}`, name: myName, text, final: true, at: Date.now() });
          } else {
            interim += ` ${text}`;
          }
        }
        interim = interim.trim();
        if (interim && Date.now() - lastInterimRef.current > INTERIM_MIN_INTERVAL_MS) {
          lastInterimRef.current = Date.now();
          getSocket()?.emit('meeting:caption', { meetingId, text: interim, final: false });
          pushLine({ id: `me-live`, name: myName, text: interim, final: false, at: Date.now() });
        }
      };

      r.onerror = (ev) => {
        const code = ev?.error;
        // Terminal conditions: retrying can never fix them, and the old code let
        // most of them fall through to onend's instant restart — an invisible hot
        // loop where the button stayed lit and captions simply never appeared.
        if (FATAL_ERRORS[code]) {
          setError(FATAL_ERRORS[code]);
          stop();
          return;
        }
        // 'network' is Chrome's cloud speech service being unreachable. Worth
        // retrying, but say so rather than failing silently.
        if (code === 'network') {
          failuresRef.current += 1;
          setError('Captions lost their connection to the speech service — retrying…');
          return;
        }
        // 'no-speech' / 'aborted' are routine; onend restarts them.
      };

      r.onend = () => {
        // The browser ends sessions on its own; keep going while still enabled.
        if (!enabledRef.current) return;
        if (failuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
          setError('Live captions keep failing to start. Check your connection and try again.');
          stop();
          return;
        }
        // Backoff: start() immediately after end() often throws, and looping on it
        // pins the CPU. One delayed attempt, then a rebuilt recogniser.
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = setTimeout(() => {
          if (!enabledRef.current) return;
          try {
            r.start();
          } catch {
            try {
              const next = build();
              recogRef.current = next;
              next.start();
            } catch {
              failuresRef.current += 1;
              setError('Could not restart live captions.');
              stop();
            }
          }
        }, RESTART_DELAY_MS);
      };

      return r;
    };

    try {
      const r = build();
      recogRef.current = r;
      enabledRef.current = true;
      failuresRef.current = 0; // fresh attempt after a previous give-up
      setError(null);
      setEnabled(true);
      r.start();
    } catch {
      setError('Could not start live captions.');
      stop();
    }
  }, [meetingId, myName, pushLine, stop]);

  const toggle = useCallback(() => {
    if (enabledRef.current) stop();
    else start();
  }, [start, stop]);

  // Never leave a recognizer running after the room unmounts.
  useEffect(() => () => stop(), [stop]);

  return { enabled, lines, error, supported: captionsSupported(), toggle, stop };
}
