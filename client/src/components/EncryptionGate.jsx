import { useEffect, useState } from 'react';
import { ShieldCheck, KeyRound, AlertTriangle, Loader2, LogOut } from 'lucide-react';
import toast from 'react-hot-toast';

import { useAuth } from '../store/useAuth';
import { useChat } from '../store/useChat';
import { useE2EE } from '../store/useE2EE';
import Button from './ui/Button';
import { Input, Field } from './ui/Input';

/**
 * Encryption is not optional in this product, so it cannot be a setting either —
 * this gate stands between sign-in and the app until the signed-in account has an
 * identity AND this device holds the private key.
 *
 * Why a hard gate rather than a prompt: every chat is sealed with a key wrapped
 * for each member, so a member with no published public key cannot be sealed
 * FOR. One person skipping setup would make their conversations unencryptable
 * for everyone else in them, which is exactly the hole "always on" is meant to
 * close.
 *
 * Two states, same reason as the modal it replaces for first-run:
 *   • `none`   → mint an identity and choose a passphrase.
 *   • `locked` → an identity exists; this device needs the passphrase.
 *
 * The one deliberate escape hatch is `unsupported`: WebCrypto is unavailable on
 * an insecure origin, and no passphrase can conjure it. Blocking the entire app
 * on a plain-http origin would be a worse failure than running unencrypted, so
 * that case passes through with a warning instead. (Nothing gets sealed there,
 * so nothing becomes unreadable — it degrades, it doesn't corrupt.)
 */
export default function EncryptionGate({ children }) {
  const status = useE2EE((s) => s.status);
  const busy = useE2EE((s) => s.busy);
  const setup = useE2EE((s) => s.setup);
  const unlock = useE2EE((s) => s.unlock);
  const logout = useAuth((s) => s.logout);

  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');

  const blocking = status === 'none' || status === 'locked';
  const mode = status === 'locked' ? 'unlock' : 'create';

  useEffect(() => {
    if (status === 'unsupported') {
      toast.error('This browser can’t encrypt (needs HTTPS) — messages will not be end-to-end encrypted.', { duration: 6000 });
    }
  }, [status]);

  // Clear the fields when switching between create and unlock, so a half-typed
  // passphrase from one state can't be submitted against the other.
  useEffect(() => {
    setPassphrase('');
    setConfirm('');
    setAcknowledged(false);
    setError('');
  }, [mode]);

  /* `idle` means init() hasn't answered yet. Rendering the app here would flash
     unsealed chats for a moment, and rendering the gate would flash a passphrase
     prompt at someone who is already set up — so render neither. */
  if (status === 'idle') {
    return (
      <div className="grid h-[100dvh] place-items-center bg-[rgb(var(--app-bg))]">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-500/30 border-t-brand-500" />
      </div>
    );
  }

  if (!blocking) return children;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (mode === 'create') {
        if (passphrase !== confirm) return setError('The two passphrases don’t match.');
        if (!acknowledged) return setError('Please confirm you understand the passphrase can’t be recovered.');
        await setup(passphrase);
        toast.success('Encryption is on 🔒');
      } else {
        await unlock(passphrase);
        toast.success('Encryption unlocked');
      }
      // Anything already fetched is showing locked placeholders; decrypt it now.
      await useChat.getState().rehydrateAll();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Something went wrong.');
    }
    return undefined;
  };

  return (
    <div className="relative grid h-[100dvh] place-items-center overflow-hidden bg-[rgb(var(--app-bg))] p-4">
      <div className="pointer-events-none absolute inset-0 bg-brand-gradient opacity-10 blur-[120px]" />

      <form onSubmit={submit} className="glass relative w-full max-w-sm rounded-3xl p-7 shadow-soft-lg">
        <div className="mb-5 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow">
            {mode === 'create' ? <ShieldCheck size={26} /> : <KeyRound size={26} />}
          </div>
          <h1 className="text-xl font-bold text-content">
            {mode === 'create' ? 'Set up encryption' : 'Unlock encryption'}
          </h1>
          <p className="mt-1 text-sm text-content-muted">
            {mode === 'create'
              ? 'Every conversation here is end-to-end encrypted. Choose a passphrase to protect your key — it never leaves this device.'
              : 'This device needs your passphrase to open your encrypted messages.'}
          </p>
        </div>

        <div className="space-y-3">
          <Field label={mode === 'create' ? 'Choose a passphrase' : 'Your passphrase'}>
            <Input
              type="password"
              autoFocus
              autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
              placeholder="At least 8 characters"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          </Field>

          {mode === 'create' && (
            <>
              <Field label="Confirm passphrase">
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Type it again"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </Field>

              {/* Not boilerplate: the passphrase is the ONLY thing that opens the
                  private key. That property is what stops the server reading your
                  messages, and it is also why losing it is unrecoverable. Saying
                  so before they commit is the point of this screen. */}
              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl neu-inset bg-surface-2/40 p-3">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500"
                />
                <span className="text-xs leading-relaxed text-content-muted">
                  <AlertTriangle size={13} className="mr-1 inline align-[-2px] text-amber-500" />
                  I understand this passphrase cannot be recovered. If I lose it, my encrypted
                  messages cannot be read again — not by me, and not by support.
                </span>
              </label>
            </>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <Button type="submit" className="w-full" disabled={busy || passphrase.length < 8}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
            {busy ? 'Working…' : mode === 'create' ? 'Turn on encryption' : 'Unlock'}
          </Button>

          {/* No "skip" — that is the point of the gate. Signing out is the only
              way past it, and it must stay reachable or a wrong account on a
              shared device would be a dead end. */}
          <button
            type="button"
            onClick={logout}
            className="mx-auto flex items-center gap-1.5 pt-1 text-xs font-medium text-content-muted transition-colors hover:text-content"
          >
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </form>
    </div>
  );
}
