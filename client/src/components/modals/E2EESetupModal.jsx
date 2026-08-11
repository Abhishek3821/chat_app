import { useEffect, useState } from 'react';
import { Lock, ShieldCheck, KeyRound, AlertTriangle, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { Input, Field } from '../ui/Input';
import { useE2EE } from '../../store/useE2EE';
import { useChat } from '../../store/useChat';

/**
 * Set up (or unlock) end-to-end encryption.
 *
 * Two states in one dialog, because the user's mental model is one thing —
 * "let me into my encrypted messages":
 *   • `none`   → create an identity and choose a passphrase.
 *   • `locked` → an identity exists; this device needs the passphrase to
 *                unwrap it (a new browser, or after "lock this device").
 *
 * The warning is not boilerplate. The passphrase is the ONLY thing that can
 * open the private key — that is what makes the server unable to read your
 * messages, and it's also what makes a forgotten passphrase unrecoverable.
 * Saying so before they commit is the whole reason this is a dialog and not a
 * silent background step.
 */
export default function E2EESetupModal({ open, onClose, chatId }) {
  const status = useE2EE((s) => s.status);
  const busy = useE2EE((s) => s.busy);
  const setup = useE2EE((s) => s.setup);
  const unlock = useE2EE((s) => s.unlock);
  const enableForChat = useE2EE((s) => s.enableForChat);

  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');

  const mode = status === 'locked' ? 'unlock' : 'create';

  useEffect(() => {
    if (open) {
      setPassphrase('');
      setConfirm('');
      setAcknowledged(false);
      setError('');
    }
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (mode === 'create') {
        if (passphrase !== confirm) return setError('The two passphrases don’t match.');
        if (!acknowledged) return setError('Please confirm you understand the passphrase can’t be recovered.');
        await setup(passphrase);
        toast.success('Encryption is set up 🔒');
      } else {
        await unlock(passphrase);
        toast.success('Encryption unlocked');
      }

      // Came here from "Encrypt this chat" — finish that job rather than making
      // them find the button again.
      if (chatId) {
        try {
          await enableForChat(chatId);
          toast.success('This chat is now end-to-end encrypted 🔒');
        } catch (err) {
          toast.error(err?.response?.data?.message || err.message || 'Set up, but this chat couldn’t be encrypted yet.');
        }
        await useChat.getState().loadChats();
      }
      /* Every conversation already on screen is showing the locked placeholder
         on its sealed bubbles. Now that a key is in memory, run the decrypt pass
         again so they turn into readable messages without a reload. */
      await useChat.getState().rehydrateAll();
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Something went wrong.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'create' ? 'Set up encryption' : 'Unlock encryption'}
      subtitle={
        mode === 'create'
          ? 'One passphrase protects your messages on every device.'
          : 'Enter your passphrase to read encrypted chats on this device.'
      }
    >
      <form onSubmit={submit} className="space-y-4 pb-1">
        <div className="flex items-start gap-3 rounded-2xl neu-inset bg-surface-2/60 p-3.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-gradient text-white shadow-glow">
            <ShieldCheck size={18} />
          </span>
          <p className="text-xs leading-relaxed text-content-muted">
            Your messages are sealed on your device with a key only you hold. We store that key encrypted under your
            passphrase — <b className="text-content">we never see the passphrase or the key</b>, which is exactly why
            we can’t read your encrypted chats.
          </p>
        </div>

        <Field label={mode === 'create' ? 'Choose a passphrase' : 'Your passphrase'}>
          <Input
            icon={KeyRound}
            type="password"
            autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="At least 8 characters"
            autoFocus
          />
        </Field>

        {mode === 'create' && (
          <>
            <Field label="Confirm passphrase">
              <Input
                icon={KeyRound}
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Type it again"
              />
            </Field>

            <label className="flex cursor-pointer items-start gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500"
              />
              <span className="text-xs leading-relaxed text-amber-800 dark:text-amber-200">
                <AlertTriangle size={13} className="mr-1 inline align-[-2px]" />
                I understand that if I forget this passphrase, my encrypted messages cannot be recovered — by me or by
                anyone else.
              </span>
            </label>
          </>
        )}

        {error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-xs font-medium text-red-500">{error}</p>}

        <Button type="submit" disabled={busy || passphrase.length < 8} className="w-full">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
          {busy ? 'Working…' : mode === 'create' ? 'Turn on encryption' : 'Unlock'}
        </Button>
      </form>
    </Modal>
  );
}
