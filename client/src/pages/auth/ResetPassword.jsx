import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Lock, Eye, EyeOff, ShieldCheck, Check, X, ArrowLeft, Loader2 } from 'lucide-react';

import Button from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { AuthShowcase, AuthPanel, MobileBrand, rise, pageMotion } from './Login.jsx';

function Requirement({ met, children }) {
  return (
    <li className={cn('flex items-center gap-2 transition-colors', met ? 'text-emerald-500' : 'text-content-muted')}>
      <span
        className={cn(
          'grid h-4 w-4 place-items-center rounded-full transition-colors',
          met ? 'bg-emerald-500/15' : 'bg-content/10'
        )}
      >
        {met ? <Check size={11} /> : <X size={11} className="opacity-40" />}
      </span>
      {children}
    </li>
  );
}

export default function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ password: '', confirm: '' });

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const checks = useMemo(
    () => ({
      length: form.password.length >= 6,
      mixed: /[A-Za-z]/.test(form.password) && /\d/.test(form.password),
      match: form.password.length > 0 && form.password === form.confirm,
    }),
    [form]
  );

  const canSubmit = checks.length && checks.match && !submitting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    if (!checks.length) return toast.error('Password must be at least 6 characters.');
    if (!checks.match) return toast.error('Passwords do not match.');

    setSubmitting(true);
    // Simulated reset — token would be posted to the API in a real backend.
    await new Promise((r) => setTimeout(r, 900));
    setSubmitting(false);
    toast.success('Password updated — please sign in.');
    navigate('/login');
  };

  return (
    <motion.div {...pageMotion} className="flex min-h-screen w-full">
      <AuthShowcase
        eyebrow="Secure reset"
        headline={
          <>
            A fresh start,
            <br />
            <span className="text-cyan-300">safely</span> done.
          </>
        }
        sub="Choose a strong new password. We keep your account protected with end-to-end security."
      />

      <AuthPanel>
        <MobileBrand />

        <motion.div variants={rise} className="mb-8 flex justify-center lg:justify-start">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-500/10 text-brand-500">
            <ShieldCheck size={26} />
          </span>
        </motion.div>

        <motion.div variants={rise}>
          <h2 className="font-display text-2xl font-extrabold tracking-tight text-content">Set a new password</h2>
          <p className="mt-1.5 text-sm text-content-muted">
            {token
              ? 'Your reset link is verified. Choose a new password below.'
              : 'Choose a new password for your account below.'}
          </p>
        </motion.div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <motion.div variants={rise}>
            <Field label="New password">
              <div className="relative">
                <Input
                  icon={Lock}
                  type={showPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Enter a new password"
                  className="pr-11"
                  value={form.password}
                  onChange={set('password')}
                  autoFocus
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  className="ring-brand absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-content-muted transition-colors hover:text-content"
                >
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </Field>
          </motion.div>

          <motion.div variants={rise}>
            <Field label="Confirm password">
              <Input
                icon={Lock}
                type={showPw ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="Re-enter your password"
                value={form.confirm}
                onChange={set('confirm')}
                className={cn(
                  form.confirm.length > 0 && !checks.match && 'border-red-500/70 focus-visible:ring-red-500/40'
                )}
                required
              />
            </Field>
          </motion.div>

          <motion.ul variants={rise} className="space-y-1.5 rounded-2xl border border-border bg-surface-2/60 px-4 py-3 text-xs">
            <Requirement met={checks.length}>At least 6 characters</Requirement>
            <Requirement met={checks.mixed}>Letters and numbers (recommended)</Requirement>
            <Requirement met={checks.match}>Both passwords match</Requirement>
          </motion.ul>

          <motion.div variants={rise}>
            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={!canSubmit}>
              {submitting ? (
                <>
                  <Loader2 size={18} className="animate-spin" /> Updating…
                </>
              ) : (
                <>
                  <ShieldCheck size={18} /> Reset password
                </>
              )}
            </Button>
          </motion.div>
        </form>

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
