import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { ShieldCheck, ArrowLeft, ArrowRight, RotateCw, MessageSquareLock, Loader2 } from 'lucide-react';

import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/useAuth';
import { DEMO_MODE } from '@/lib/api';
import { AuthShowcase, AuthPanel, MobileBrand, rise, pageMotion } from './Login.jsx';

const LENGTH = 6;
const RESEND_SECONDS = 30;

export default function VerifyOtp() {
  const navigate = useNavigate();
  const location = useLocation();
  const { verifyOtp, resendOtp } = useAuth();
  const email = location.state?.email || '';
  const inputsRef = useRef([]);
  const [digits, setDigits] = useState(Array(LENGTH).fill(''));
  const [submitting, setSubmitting] = useState(false);
  const [seconds, setSeconds] = useState(RESEND_SECONDS);
  const [devOtp, setDevOtp] = useState(location.state?.devOtp || '');

  const code = digits.join('');
  const isComplete = code.length === LENGTH;

  // Real mode requires the email we're verifying; if it's missing, go back.
  useEffect(() => {
    if (!DEMO_MODE && !email) navigate('/signup', { replace: true });
  }, [email, navigate]);

  // Resend countdown.
  useEffect(() => {
    if (seconds <= 0) return undefined;
    const id = setInterval(() => setSeconds((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(id);
  }, [seconds]);

  const focusInput = (i) => inputsRef.current[i]?.focus();

  const verify = async (value = code) => {
    if (value.length !== LENGTH || submitting) return;
    setSubmitting(true);
    try {
      await verifyOtp({ email, otp: value });
      toast.success('Verified! Welcome to ChatConnect.');
      navigate('/');
    } catch (err) {
      toast.error(err?.message || 'Invalid or expired code.');
      setDigits(Array(LENGTH).fill(''));
      requestAnimationFrame(() => focusInput(0));
    } finally {
      setSubmitting(false);
    }
  };

  const handleChange = (index, raw) => {
    const val = raw.replace(/\D/g, '');
    if (!val) {
      // Clear this box (covers deletion via input).
      setDigits((prev) => {
        const next = [...prev];
        next[index] = '';
        return next;
      });
      return;
    }
    // If multiple chars arrive (fast typing / mobile), distribute them.
    setDigits((prev) => {
      const next = [...prev];
      const chars = val.split('');
      let i = index;
      for (const c of chars) {
        if (i >= LENGTH) break;
        next[i] = c;
        i += 1;
      }
      const landing = Math.min(index + chars.length, LENGTH - 1);
      requestAnimationFrame(() => focusInput(landing));
      if (next.join('').length === LENGTH) requestAnimationFrame(() => verify(next.join('')));
      return next;
    });
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      setDigits((prev) => {
        const next = [...prev];
        if (next[index]) {
          next[index] = '';
        } else if (index > 0) {
          next[index - 1] = '';
          focusInput(index - 1);
        }
        return next;
      });
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      focusInput(index - 1);
    } else if (e.key === 'ArrowRight' && index < LENGTH - 1) {
      e.preventDefault();
      focusInput(index + 1);
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, LENGTH);
    if (!text) return;
    const next = Array(LENGTH).fill('');
    text.split('').forEach((c, i) => (next[i] = c));
    setDigits(next);
    const landing = Math.min(text.length, LENGTH - 1);
    requestAnimationFrame(() => focusInput(landing));
    if (text.length === LENGTH) requestAnimationFrame(() => verify(text));
  };

  const handleResend = async () => {
    if (seconds > 0) return;
    setDigits(Array(LENGTH).fill(''));
    setSeconds(RESEND_SECONDS);
    focusInput(0);
    try {
      const res = await resendOtp(email);
      if (res?.devOtp) setDevOtp(res.devOtp);
      toast.success('A new code is on its way.');
    } catch (err) {
      toast.error(err?.message || 'Could not resend the code.');
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!isComplete) return toast.error('Please enter all 6 digits.');
    verify();
  };

  const resendLabel = useMemo(
    () => (seconds > 0 ? `Resend code in 0:${String(seconds).padStart(2, '0')}` : 'Resend code'),
    [seconds]
  );

  return (
    <motion.div {...pageMotion} className="flex min-h-screen w-full">
      <AuthShowcase
        eyebrow="One last step"
        headline={
          <>
            Verify it&apos;s
            <br />
            really <span className="text-cyan-300">you</span>.
          </>
        }
        sub="We've sent a 6-digit verification code to keep your account secure. Enter it to continue."
      />

      <AuthPanel>
        <MobileBrand />

        <motion.div variants={rise} className="mb-8 flex justify-center lg:justify-start">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-500/10 text-brand-500">
            <MessageSquareLock size={26} />
          </span>
        </motion.div>

        <motion.div variants={rise}>
          <h2 className="font-display text-2xl font-extrabold tracking-tight text-content">Enter verification code</h2>
          <p className="mt-1.5 text-sm text-content-muted">
            We sent a 6-digit code to {email ? <span className="font-semibold text-content">{email}</span> : 'your email'}. Enter it below to verify your account.
          </p>
        </motion.div>

        <form onSubmit={handleSubmit} className="mt-8">
          <motion.div variants={rise} className="flex justify-between gap-2 sm:gap-3" onPaste={handlePaste}>
            {digits.map((digit, i) => (
              <input
                key={i}
                ref={(el) => (inputsRef.current[i] = el)}
                type="text"
                inputMode="numeric"
                autoComplete={i === 0 ? 'one-time-code' : 'off'}
                maxLength={LENGTH}
                value={digit}
                autoFocus={i === 0}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                onFocus={(e) => e.target.select()}
                aria-label={`Digit ${i + 1}`}
                className={cn(
                  'ring-brand h-14 w-full rounded-2xl border bg-surface-2 text-center text-2xl font-bold text-content transition-all',
                  digit ? 'border-brand-500 shadow-glow' : 'border-border hover:border-content-muted/50'
                )}
              />
            ))}
          </motion.div>

          {devOtp && (
            <motion.p
              variants={rise}
              className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-center text-xs text-amber-600 dark:text-amber-300"
            >
              Email isn&apos;t configured on the server — your development code is{' '}
              <span className="text-sm font-extrabold tracking-[0.3em]">{devOtp}</span>
            </motion.p>
          )}

          <motion.div variants={rise} className="mt-8">
            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={!isComplete || submitting}>
              {submitting ? (
                <>
                  <Loader2 size={18} className="animate-spin" /> Verifying…
                </>
              ) : (
                <>
                  <ShieldCheck size={18} /> Verify &amp; continue <ArrowRight size={18} />
                </>
              )}
            </Button>
          </motion.div>
        </form>

        <motion.div variants={rise} className="mt-6 text-center text-sm text-content-muted">
          Didn&apos;t receive a code?{' '}
          <button
            type="button"
            onClick={handleResend}
            disabled={seconds > 0}
            className={cn(
              'ring-brand inline-flex items-center gap-1.5 rounded-lg font-semibold transition-colors',
              seconds > 0
                ? 'cursor-not-allowed text-content-muted/70'
                : 'text-brand-600 hover:text-brand-500 dark:text-brand-300'
            )}
          >
            <RotateCw size={14} className={cn(seconds > 0 && 'opacity-50')} />
            {resendLabel}
          </button>
        </motion.div>

        <motion.div variants={rise} className="mt-6 text-center">
          <Link
            to="/login"
            className="ring-brand inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-content-muted transition-colors hover:text-content"
          >
            <ArrowLeft size={16} /> Back to sign in
          </Link>
        </motion.div>
      </AuthPanel>
    </motion.div>
  );
}
