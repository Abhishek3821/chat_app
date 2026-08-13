import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  Sparkles,
  ShieldCheck,
  Zap,
  Globe,
  Loader2,
  AtSign,
} from 'lucide-react';

import Button from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { LogoFull } from '@/components/brand/Logo';
import { useAuth } from '@/store/useAuth';
import { DEMO_MODE } from '@/lib/api';

/* Shared animation presets ------------------------------------------------- */
export const pageMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0, transition: { duration: 0.2 } },
  transition: { duration: 0.35, ease: 'easeOut' },
};

export const stagger = {
  animate: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } },
};

export const rise = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
};

/* Reusable left-hand branded showcase -------------------------------------- */
export function AuthShowcase({
  eyebrow = 'Welcome back',
  headline = (
    <>
      Conversations that
      <br />
      feel <span className="text-cyan-300">effortless</span>.
    </>
  ),
  sub = 'ChatKonect brings your people, calls, and moments together in one beautifully fast space.',
  features = [
    { icon: ShieldCheck, title: 'Encrypted in transit', desc: 'Secured with TLS on every connection.' },
    { icon: Zap, title: 'Lightning quick', desc: 'Realtime delivery with zero lag.' },
    { icon: Globe, title: 'Everywhere you are', desc: 'Sync seamlessly across devices.' },
  ],
}) {
  return (
    <div className="relative hidden overflow-hidden bg-brand-gradient lg:flex lg:w-1/2 lg:flex-col xl:w-[52%] 2xl:w-[54%]">
      {/* Mesh + decorative blurred blobs */}
      <div className="absolute inset-0 bg-mesh-dark opacity-70" />
      <div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-cyan-400/30 blur-3xl" />
      <div className="absolute -bottom-32 -right-16 h-96 w-96 rounded-full bg-violet-500/30 blur-3xl" />
      <div className="absolute right-1/4 top-1/3 h-40 w-40 rounded-full bg-white/10 blur-2xl" />

      {/* Floating glass cards */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.4, duration: 0.6 }}
        className="animate-float absolute right-10 top-24 hidden w-52 rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-xl xl:block"
        style={{ animationDelay: '0.4s' }}
      >
        <div className="mb-2 flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
          <span className="text-xs font-semibold text-white/90">Ava is typing…</span>
        </div>
        <div className="space-y-1.5">
          <div className="h-2 w-full rounded-full bg-white/25" />
          <div className="h-2 w-2/3 rounded-full bg-white/20" />
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.6, duration: 0.6 }}
        className="animate-float absolute bottom-28 right-24 hidden items-center gap-3 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 backdrop-blur-xl xl:flex"
        style={{ animationDelay: '1.4s' }}
      >
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/20">
          <Sparkles size={16} className="text-white" />
        </div>
        <div>
          <p className="text-xs font-bold text-white">4M+ messages</p>
          <p className="text-[11px] text-white/70">delivered today</p>
        </div>
      </motion.div>

      {/* Content */}
      <div className="relative z-10 flex h-full flex-col justify-between p-10 xl:p-12 2xl:p-16">
        {/* This panel is dark in both themes, so pin the mark's gradient to its
            dark-mode steps — the light-theme --logo-from is brand-600, which is
            exactly this panel's own background (an invisible logo). Pointed at
            the brand scale rather than literal mint, so the accent still
            reaches the mark here. */}
        <LogoFull
          className="[--logo-from:var(--brand-300)] [--logo-to:var(--brand-400)] [&_span]:text-white [&_.gradient-text]:!bg-none [&_.gradient-text]:!text-cyan-200"
          markSize={38}
        />

        <motion.div variants={stagger} initial="initial" animate="animate" className="max-w-md xl:max-w-lg 2xl:max-w-2xl">
          <motion.span
            variants={rise}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur-md"
          >
            <Sparkles size={13} /> {eyebrow}
          </motion.span>
          <motion.h1
            variants={rise}
            className="mt-5 font-display text-4xl font-extrabold leading-[1.1] tracking-tight text-white xl:text-5xl 2xl:text-6xl"
          >
            {headline}
          </motion.h1>
          <motion.p variants={rise} className="mt-4 text-base leading-relaxed text-white/80 2xl:text-lg">
            {sub}
          </motion.p>

          <motion.ul variants={stagger} className="mt-9 space-y-4">
            {features.map(({ icon: Icon, title, desc }) => (
              <motion.li key={title} variants={rise} className="flex items-start gap-3.5">
                <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/20 bg-white/10 backdrop-blur-md">
                  <Icon size={18} className="text-cyan-200" />
                </span>
                <div>
                  <p className="font-semibold text-white">{title}</p>
                  <p className="text-sm text-white/70">{desc}</p>
                </div>
              </motion.li>
            ))}
          </motion.ul>
        </motion.div>

        {/* /50 lands at ~3.3:1 on the teal panel — too low for 12px copy. */}
        <p className="text-xs text-white/70">© {new Date().getFullYear()} ChatKonect. Crafted for real connection.</p>
      </div>
    </div>
  );
}

/* Shared right-hand shell -------------------------------------------------- */
export function AuthPanel({ children }) {
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[rgb(var(--app-bg))] px-4 py-8 xs:px-5 xs:py-10 sm:px-8 2xl:px-12">
      {/* Soft ambient glow on mobile / light-mode balance */}
      <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-brand-500/10 blur-3xl" />
      {/* p-8 + the panel gutter left only ~216px of usable card width at 320px,
          which crushed the OTP boxes and the inline "Verify" rows. Step it up. */}
      <motion.div
        variants={stagger}
        initial="initial"
        animate="animate"
        className="glass-strong relative w-full max-w-md rounded-3xl p-5 shadow-soft-lg xs:p-7 sm:p-10 2xl:max-w-lg 2xl:p-12"
      >
        {children}
      </motion.div>
    </div>
  );
}

/* Compact logo for mobile top of the form panel ---------------------------- */
export function MobileBrand() {
  return (
    <motion.div variants={rise} className="mb-6 flex justify-center xs:mb-8 lg:hidden">
      <LogoFull markSize={34} />
    </motion.div>
  );
}

export default function Login() {
  const navigate = useNavigate();
  const { login, loading } = useAuth();
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', remember: true });

  const set = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting || loading) return;
    setSubmitting(true);
    try {
      await login({ identifier: form.email.trim(), password: form.password });
      toast.success('Welcome back to ChatKonect!');
      navigate('/');
    } catch (err) {
      const msg = err?.message || 'Could not sign you in. Please try again.';
      // Unverified account → send them to the email-verification screen.
      if (/verify your email/i.test(msg) && form.email.includes('@')) {
        toast.error('Your email is not verified yet — enter the code we emailed you.');
        navigate('/verify-otp', { state: { email: form.email.trim().toLowerCase() } });
      } else {
        toast.error(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const busy = submitting || loading;

  return (
    <motion.div {...pageMotion} className="flex min-h-[100dvh] w-full">
      <AuthShowcase />

      <AuthPanel>
        <MobileBrand />

        <motion.div variants={rise}>
          <h2 className="font-display text-2xl font-extrabold tracking-tight text-content">Sign in</h2>
          <p className="mt-1.5 text-sm text-content-muted">
            Great to see you again — pick up right where you left off.
          </p>
        </motion.div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <motion.div variants={rise}>
            <Field label="Email, username or phone">
              <Input
                icon={AtSign}
                type="text"
                autoComplete="username"
                placeholder="you@example.com · @username · +91 98765 43210"
                value={form.email}
                onChange={set('email')}
                required
              />
            </Field>
          </motion.div>

          <motion.div variants={rise}>
            <Field label="Password">
              <div className="relative">
                <Input
                  icon={Lock}
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className="pr-12"
                  value={form.password}
                  onChange={set('password')}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  className="ring-brand absolute right-1 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-xl text-content-muted transition-colors hover:text-content sm:right-1.5 sm:h-10 sm:w-10"
                >
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </Field>
          </motion.div>

          {/* py-3/-my-3 grows both hit areas to 44px without changing the row height. */}
          <motion.div variants={rise} className="flex items-center justify-between gap-3">
            <label className="-my-3 flex cursor-pointer select-none items-center gap-2 py-3 text-sm text-content-muted">
              <input
                type="checkbox"
                checked={form.remember}
                onChange={set('remember')}
                className="ring-brand h-4 w-4 shrink-0 rounded border-border bg-surface-2 text-brand-500 accent-brand-500"
              />
              Remember me
            </label>
            <Link
              to="/forgot-password"
              className="ring-brand -my-3 shrink-0 rounded-lg py-3 text-sm font-semibold text-brand-600 transition-colors hover:text-brand-500 dark:text-brand-300"
            >
              Forgot password?
            </Link>
          </motion.div>

          <motion.div variants={rise}>
            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 size={18} className="animate-spin" /> Signing in…
                </>
              ) : (
                <>
                  Sign in <ArrowRight size={18} />
                </>
              )}
            </Button>
          </motion.div>
        </form>

        {DEMO_MODE && (
          <motion.p
            variants={rise}
            className="mt-5 flex items-center justify-center gap-1.5 rounded-xl neu-inset bg-surface-2/60 px-3 py-2.5 text-center text-xs text-content-muted"
          >
            <Sparkles size={13} className="shrink-0 text-brand-500 dark:text-brand-300" />
            Explore instantly — any email &amp; password works in demo mode.
          </motion.p>
        )}

        <motion.p variants={rise} className="mt-6 text-center text-sm text-content-muted">
          New to ChatKonect?{' '}
          <Link to="/signup" className="font-semibold text-brand-600 transition-colors hover:text-brand-500 dark:text-brand-300">
            Create an account
          </Link>
        </motion.p>
      </AuthPanel>
    </motion.div>
  );
}
