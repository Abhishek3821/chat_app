import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Lock, ShieldCheck, Delete } from 'lucide-react';
import { useAuth } from '../store/useAuth';
import Avatar from './ui/Avatar';
import Button from './ui/Button';
import PinResetForm from './PinResetForm';

/** Shown when two-step verification is on and this session isn't unlocked yet. */
export default function LockScreen({ onUnlock }) {
  const { verifyTwoStep, logout, user } = useAuth();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [mode, setMode] = useState('pin'); // pin | forgot
  const inputRef = useRef(null);

  const submit = async (e) => {
    e?.preventDefault();
    if (pin.length < 4 || busy) return;
    setBusy(true);
    try {
      await verifyTwoStep(pin);
      onUnlock();
    } catch (err) {
      toast.error(err?.message || 'Incorrect PIN.');
      setPin('');
      setShake(true);
      setTimeout(() => setShake(false), 500);
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative grid h-screen place-items-center overflow-hidden bg-[rgb(var(--app-bg))] p-4">
      {/* Soft brand glow behind the card */}
      <div className="pointer-events-none absolute inset-0 bg-brand-gradient opacity-10 blur-[120px]" />

      <div className={`glass relative w-full max-w-sm rounded-3xl p-7 text-center shadow-soft-lg ${shake ? 'animate-shake' : ''}`}>
        {mode === 'forgot' ? (
          <PinResetForm onDone={onUnlock} onCancel={() => setMode('pin')} />
        ) : (
          <form onSubmit={submit}>
            <div className="relative mx-auto mb-4 h-16 w-16">
              <Avatar src={user?.avatar} name={user?.name} size="xl" className="mx-auto" />
              <span className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full bg-brand-500 text-white ring-4 ring-[rgb(var(--app-bg))]">
                <Lock size={13} />
              </span>
            </div>
            <h1 className="font-display text-lg font-bold text-content">ChatConnect is locked</h1>
            <p className="mt-1 text-sm text-content-muted">
              Hi {user?.name?.split(' ')[0] || 'there'} — enter your PIN to open your chats.
            </p>

            {/* PIN dots reflect what's typed in the (real) input below */}
            <button
              type="button"
              onClick={() => inputRef.current?.focus()}
              className="mx-auto mt-5 flex h-8 items-center justify-center gap-2.5"
              tabIndex={-1}
            >
              {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
                <span
                  key={i}
                  className={`h-3.5 w-3.5 rounded-full transition-all ${i < pin.length ? 'scale-110 bg-brand-500' : 'bg-content/15'}`}
                />
              ))}
            </button>
            <input
              ref={inputRef}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              inputMode="numeric"
              autoFocus
              type="password"
              aria-label="PIN"
              className="sr-only"
            />

            <div className="mt-4 flex items-center justify-center gap-2">
              <Button type="submit" variant="primary" className="w-full justify-center" disabled={busy || pin.length < 4}>
                <ShieldCheck size={16} /> {busy ? 'Checking…' : 'Unlock'}
              </Button>
              {pin.length > 0 && (
                <Button type="button" variant="subtle" className="shrink-0" onClick={() => setPin((p) => p.slice(0, -1))} title="Delete digit">
                  <Delete size={16} />
                </Button>
              )}
            </div>

            <div className="mt-4 flex items-center justify-center gap-4 text-xs font-medium">
              <button type="button" onClick={() => setMode('forgot')} className="text-brand-500 hover:underline">
                Forgot PIN?
              </button>
              <button type="button" onClick={logout} className="text-content-muted hover:text-content">
                Log out instead
              </button>
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-content-muted/80">
              Two-step verification protects this account and your locked chats.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
