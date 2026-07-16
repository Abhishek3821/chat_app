import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { MailCheck, KeyRound } from 'lucide-react';
import { useAuth } from '../store/useAuth';
import Button from './ui/Button';

/**
 * Forgot-PIN recovery: emails an OTP to the account address, then lets the user
 * set a brand-new PIN. Used by the app LockScreen and the Locked-chats folder.
 * Locked chats stay locked — they simply open with the NEW PIN.
 */
export default function PinResetForm({ onDone, onCancel }) {
  const { requestTwoStepReset, resetTwoStepPin, user } = useAuth();
  const [sending, setSending] = useState(true);
  const [sentTo, setSentTo] = useState('');
  const [devOtp, setDevOtp] = useState('');
  const [otp, setOtp] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const requested = useRef(false);

  const sendCode = async () => {
    setSending(true);
    try {
      const r = await requestTwoStepReset();
      setSentTo(r?.email || user?.email || 'your email');
      if (r?.devOtp) setDevOtp(String(r.devOtp));
      toast.success('Verification code sent.');
    } catch (err) {
      toast.error(err?.message || 'Could not send the code.');
    } finally {
      setSending(false);
    }
  };

  // Request the OTP once when the form opens (guarded against StrictMode double-run).
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    sendCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (otp.length < 4) return toast.error('Enter the code from your email.');
    if (!/^\d{4,8}$/.test(pin)) return toast.error('Your new PIN must be 4 to 8 digits.');
    if (pin !== pin2) return toast.error('PINs do not match.');
    setBusy(true);
    try {
      await resetTwoStepPin({ otp, pin });
      toast.success('PIN reset — you’re unlocked.');
      onDone?.();
    } catch (err) {
      toast.error(err?.message || 'Could not reset your PIN.');
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    'w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-center text-content outline-none focus:border-brand-500';

  return (
    <form onSubmit={submit} className="text-center">
      <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-brand-500/10 text-brand-500">
        <MailCheck size={22} />
      </span>
      <p className="text-sm font-semibold text-content">Reset your PIN</p>
      <p className="mt-1 text-xs text-content-muted">
        {sending ? 'Sending a verification code…' : `We emailed a code to ${sentTo}. Enter it below with your new PIN.`}
      </p>
      {devOtp && (
        <p className="mt-2 rounded-lg bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-600">
          Dev code (email not configured): <span className="font-mono">{devOtp}</span>
        </p>
      )}
      <input
        value={otp}
        onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric"
        placeholder="Email code"
        autoFocus
        className={`mt-4 ${inputCls} text-lg tracking-[0.35em]`}
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          inputMode="numeric"
          type="password"
          placeholder="New PIN"
          className={inputCls}
        />
        <input
          value={pin2}
          onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 8))}
          inputMode="numeric"
          type="password"
          placeholder="Repeat PIN"
          className={inputCls}
        />
      </div>
      <Button type="submit" variant="primary" className="mt-4 w-full justify-center" disabled={busy || sending}>
        <KeyRound size={15} /> {busy ? 'Resetting…' : 'Reset PIN & unlock'}
      </Button>
      <div className="mt-3 flex items-center justify-center gap-4 text-xs font-medium">
        <button type="button" onClick={sendCode} disabled={sending} className="text-brand-500 hover:underline disabled:opacity-50">
          Resend code
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-content-muted hover:text-content">
            Back
          </button>
        )}
      </div>
    </form>
  );
}
