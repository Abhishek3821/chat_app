import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { Mail, ArrowLeft, ArrowRight, MailCheck, RotateCw, KeyRound, Loader2 } from 'lucide-react';

import Button from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { AuthShowcase, AuthPanel, MobileBrand, rise, pageMotion } from './Login.jsx';

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Simulated request — no backend call in demo mode.
  const sendLink = async () => {
    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 900));
    setSubmitting(false);
    setSubmitted(true);
    toast.success('Reset link sent — check your inbox!');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    if (!emailRe.test(email.trim())) {
      toast.error('Please enter a valid email address.');
      return;
    }
    await sendLink();
  };

  return (
    <motion.div {...pageMotion} className="flex min-h-screen w-full">
      <AuthShowcase
        eyebrow="Account recovery"
        headline={
          <>
            Locked out?
            <br />
            We&apos;ll get you <span className="text-cyan-300">back in</span>.
          </>
        }
        sub="Enter your email and we'll send a secure link to reset your password in moments."
      />

      <AuthPanel>
        <MobileBrand />

        <AnimatePresence mode="wait">
          {!submitted ? (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
            >
              <motion.div variants={rise} className="mb-8 flex justify-center lg:justify-start">
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-500/10 text-brand-500">
                  <KeyRound size={26} />
                </span>
              </motion.div>

              <h2 className="font-display text-2xl font-extrabold tracking-tight text-content">Forgot password?</h2>
              <p className="mt-1.5 text-sm text-content-muted">
                No worries. Enter the email tied to your account and we&apos;ll send you a reset link.
              </p>

              <form onSubmit={handleSubmit} className="mt-8 space-y-5">
                <Field label="Email address">
                  <Input
                    icon={Mail}
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoFocus
                    required
                  />
                </Field>

                <Button type="submit" variant="primary" size="lg" className="w-full" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 size={18} className="animate-spin" /> Sending link…
                    </>
                  ) : (
                    <>
                      Send reset link <ArrowRight size={18} />
                    </>
                  )}
                </Button>
              </form>

              <Link
                to="/login"
                className="ring-brand mt-6 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-content-muted transition-colors hover:text-content"
              >
                <ArrowLeft size={16} /> Back to sign in
              </Link>
            </motion.div>
          ) : (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
              className="text-center"
            >
              <motion.div
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.1 }}
                className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-500"
              >
                <MailCheck size={30} />
              </motion.div>

              <h2 className="mt-6 font-display text-2xl font-extrabold tracking-tight text-content">Check your inbox</h2>
              <p className="mt-2 text-sm leading-relaxed text-content-muted">
                We sent a reset link to{' '}
                <span className="font-semibold text-content">{email.trim()}</span>. Follow it to choose a new password.
              </p>

              <div className="mt-7 rounded-2xl border border-border bg-surface-2/60 px-4 py-3 text-left text-xs text-content-muted">
                Didn&apos;t get it? Check your spam folder, or resend the link below. Links expire after 30 minutes.
              </div>

              <div className="mt-6 space-y-3">
                <Button variant="glass" size="lg" className="w-full" onClick={sendLink} disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 size={18} className="animate-spin" /> Resending…
                    </>
                  ) : (
                    <>
                      <RotateCw size={17} /> Resend link
                    </>
                  )}
                </Button>
                <Button as={Link} to="/login" variant="ghost" size="lg" className="w-full">
                  <ArrowLeft size={16} /> Back to sign in
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </AuthPanel>
    </motion.div>
  );
}
