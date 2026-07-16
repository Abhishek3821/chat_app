import { useState } from 'react';
import toast from 'react-hot-toast';
import { Lock } from 'lucide-react';
import { useAuth } from '../store/useAuth';
import Button from './ui/Button';

/** Shown when two-step verification is on and this session isn't unlocked yet. */
export default function LockScreen({ onUnlock }) {
  const { verifyTwoStep, logout, user } = useAuth();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (pin.length < 4) return;
    setBusy(true);
    try {
      await verifyTwoStep(pin);
      onUnlock();
    } catch (err) {
      toast.error(err?.message || 'Incorrect PIN.');
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-screen place-items-center bg-[rgb(var(--app-bg))] p-4">
      <form onSubmit={submit} className="glass w-full max-w-xs rounded-3xl p-6 text-center shadow-soft-lg">
        <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-brand-500/10 text-brand-500">
          <Lock size={26} />
        </span>
        <h1 className="font-display text-lg font-bold text-content">Enter your PIN</h1>
        <p className="mt-1 text-sm text-content-muted">
          Two-step verification is on for {user?.name?.split(' ')[0] || 'your account'}.
        </p>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          inputMode="numeric"
          autoFocus
          type="password"
          placeholder="••••"
          className="mt-4 w-full rounded-xl border border-border bg-surface-2 px-3 py-3 text-center text-lg tracking-[0.4em] text-content outline-none focus:border-brand-500"
        />
        <Button type="submit" variant="primary" className="mt-4 w-full justify-center" disabled={busy || pin.length < 4}>
          {busy ? 'Checking…' : 'Unlock'}
        </Button>
        <button type="button" onClick={logout} className="mt-3 text-xs font-medium text-content-muted hover:text-content">
          Log out instead
        </button>
      </form>
    </div>
  );
}
