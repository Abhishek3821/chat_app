import { useEffect, useRef, useState } from 'react';

export default function DeviceCheck({ video, onJoin, busy, hasPassword, isHost, error }) {
  const previewRef = useRef(null);
  const streamRef = useRef(null);
  const [deviceError, setDeviceError] = useState('');
  const [cameraId, setCameraId] = useState('');
  const [microphoneId, setMicrophoneId] = useState('');
  const [devices, setDevices] = useState([]);
  const [password, setPassword] = useState('');
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [micLevel, setMicLevel] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let audioContext;
    let meterTimer;
    const check = async () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: microphoneId ? { exact: microphoneId } : undefined, echoCancellation: true, noiseSuppression, autoGainControl: true },
          video: video ? { deviceId: cameraId ? { exact: cameraId } : undefined } : false,
        });
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        streamRef.current = stream;
        if (previewRef.current) previewRef.current.srcObject = stream;
        setDeviceError('');
        setDevices(await navigator.mediaDevices.enumerateDevices());
        if (stream.getAudioTracks().length && window.AudioContext) {
          audioContext = new AudioContext();
          const source = audioContext.createMediaStreamSource(stream);
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          const values = new Uint8Array(analyser.fftSize);
          meterTimer = setInterval(() => {
            analyser.getByteTimeDomainData(values);
            const rms = Math.sqrt(values.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / values.length);
            setMicLevel(Math.min(100, Math.round(rms * 350)));
          }, 150);
        }
      } catch (err) { if (!cancelled) setDeviceError(err?.message || 'Camera or microphone unavailable.'); }
    };
    check();
    return () => {
      cancelled = true;
      clearInterval(meterTimer);
      audioContext?.close().catch(() => {});
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [video, cameraId, microphoneId, noiseSuppression]);

  const testSpeaker = async () => {
    try {
      const context = new AudioContext();
      await context.resume();
      const tone = context.createOscillator();
      const gain = context.createGain();
      tone.frequency.value = 440;
      gain.gain.setValueAtTime(0.08, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.35);
      tone.connect(gain).connect(context.destination);
      tone.start();
      tone.stop(context.currentTime + 0.35);
      tone.onended = () => context.close();
    } catch { setDeviceError('Speaker test could not play. Check your output device.'); }
  };

  return (
    <div className="grid min-h-[100dvh] place-items-center bg-navy-950 p-5 text-white">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-white/10 bg-white/5 p-5">
        <h1 className="text-xl font-semibold">Check devices before joining</h1>
        {video && <video ref={previewRef} autoPlay playsInline muted className="aspect-video w-full rounded-xl bg-black object-cover" />}
        {deviceError && <p className="rounded-lg bg-amber-500/15 p-2 text-sm text-amber-200">{deviceError}. You can still join without a device.</p>}
        {error && <p className="rounded-lg bg-red-500/15 p-2 text-sm text-red-200">{error}</p>}
        <label className="block text-sm">Microphone
          <select value={microphoneId} onChange={(e) => setMicrophoneId(e.target.value)} className="mt-1 w-full rounded-lg bg-navy-900 p-2">
            <option value="">System default</option>
            {devices.filter((d) => d.kind === 'audioinput').map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}
          </select>
        </label>
        <div className="space-y-1 text-xs text-white/70">
          <span>Microphone level</span>
          <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-emerald-400 transition-[width]" style={{ width: `${micLevel}%` }} /></div>
        </div>
        <button type="button" onClick={testSpeaker} className="rounded-lg bg-white/10 px-3 py-2 text-sm">Test speaker</button>
        {video && <label className="block text-sm">Camera
          <select value={cameraId} onChange={(e) => setCameraId(e.target.value)} className="mt-1 w-full rounded-lg bg-navy-900 p-2">
            <option value="">System default</option>
            {devices.filter((d) => d.kind === 'videoinput').map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>)}
          </select>
        </label>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={noiseSuppression} onChange={(e) => setNoiseSuppression(e.target.checked)} /> Background noise suppression</label>
        {hasPassword && !isHost && <label className="block text-sm">Meeting password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-lg bg-navy-900 p-2" autoComplete="off" />
        </label>}
        <button disabled={busy || (hasPassword && !isHost && !password)} onClick={() => onJoin({ password, cameraId, microphoneId, noiseSuppression })} className="w-full rounded-xl bg-brand-500 py-3 font-semibold disabled:opacity-50">{busy ? 'Joining…' : 'Join meeting'}</button>
      </div>
    </div>
  );
}
