import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  ArrowRight,
  Check,
  Rocket,
  Users,
  Heart,
  Loader2,
  Camera,
  X,
  Building2,
} from 'lucide-react';

import Button from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { useAuth } from '@/store/useAuth';
import { cn } from '@/lib/utils';
import { AuthShowcase, AuthPanel, MobileBrand, rise, pageMotion } from './Login.jsx';

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function strengthOf(pw) {
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score += 1;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score += 1;
  return score; // 0..4
}
const strengthLabels = ['Too short', 'Weak', 'Okay', 'Good', 'Strong'];
const strengthColors = ['bg-red-500', 'bg-red-500', 'bg-amber-500', 'bg-cyan-500', 'bg-emerald-500'];

/** Downscale the chosen photo to a small square JPEG data-URL (kept well under
 *  the server's 400KB avatar cap) so signup stays a single lightweight request. */
function fileToAvatarDataUrl(file, size = 384) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Please choose an image file.'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      // center-crop to a square, then scale down
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      if (dataUrl.length > 400_000) return reject(new Error('That photo is too large — try a smaller one.'));
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image.'));
    };
    img.src = url;
  });
}

export default function Signup() {
  const navigate = useNavigate();
  const { signup, loading } = useAuth();
  const [params] = useSearchParams();
  const inviteCode = (params.get('invite') || '').trim();
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState({});
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '', workspaceName: '' });
  const [accountType, setAccountType] = useState('personal'); // 'personal' | 'workspace'
  const [avatar, setAvatar] = useState(null); // data-URL preview, optional
  const fileRef = useRef(null);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const blur = (key) => () => setTouched((t) => ({ ...t, [key]: true }));

  const errors = useMemo(() => {
    const e = {};
    if (!form.name.trim()) e.name = 'Please enter your name.';
    if (!emailRe.test(form.email)) e.email = 'Enter a valid email address.';
    if (form.password.length < 8) e.password = 'At least 8 characters.';
    if (form.confirmPassword !== form.password) e.confirmPassword = 'Passwords do not match.';
    return e;
  }, [form]);

  const isValid = Object.keys(errors).length === 0;
  const strength = strengthOf(form.password);
  const busy = submitting || loading;

  const pickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    try {
      setAvatar(await fileToAvatarDataUrl(file));
    } catch (err) {
      toast.error(err.message || 'Could not use that photo.');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setTouched({ name: true, email: true, password: true, confirmPassword: true });
    if (!isValid) {
      toast.error('Please fix the highlighted fields.');
      return;
    }
    setSubmitting(true);
    try {
      const data = await signup({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        confirmPassword: form.confirmPassword,
        ...(inviteCode ? { inviteCode } : { accountType }),
        ...(!inviteCode && accountType === 'workspace' && form.workspaceName.trim()
          ? { workspaceName: form.workspaceName.trim() }
          : {}),
        ...(avatar ? { avatar } : {}),
      });
      if (data?.requiresVerification) {
        toast.success('Account created — verify your email to continue.');
        navigate('/verify-otp', { state: { email: form.email.trim(), devOtp: data.devOtp } });
      } else {
        toast.success('Your ChatConnect account is ready!');
        navigate('/');
      }
    } catch (err) {
      toast.error(err?.message || 'Could not create your account. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const fieldError = (key) => (touched[key] ? errors[key] : undefined);

  return (
    <motion.div {...pageMotion} className="flex min-h-screen w-full">
      <AuthShowcase
        eyebrow="Join ChatConnect"
        headline={
          <>
            Start something
            <br />
            <span className="text-cyan-300">worth sharing</span>.
          </>
        }
        sub="Create your free account in seconds and bring every conversation into one delightful place."
        features={[
          { icon: Rocket, title: 'Ready in seconds', desc: 'No setup, no clutter — just chat.' },
          { icon: Users, title: 'Groups & communities', desc: 'Gather your circles effortlessly.' },
          { icon: Heart, title: 'Loved by millions', desc: 'Join a community that connects.' },
        ]}
      />

      <AuthPanel>
        <MobileBrand />

        <motion.div variants={rise}>
          <h2 className="font-display text-2xl font-extrabold tracking-tight text-content">Create your account</h2>
          <p className="mt-1.5 text-sm text-content-muted">Join ChatConnect and connect in a whole new way.</p>
        </motion.div>

        {inviteCode && (
          <motion.div variants={rise} className="mt-4 flex items-center gap-2 rounded-xl border border-brand-500/30 bg-brand-500/10 px-3 py-2.5 text-sm text-content">
            <Building2 size={16} className="shrink-0 text-brand-500" />
            You’re joining a workspace by invite — you’ll be able to chat with everyone in it.
          </motion.div>
        )}

        {!inviteCode && (
          <motion.div variants={rise} className="mt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-muted">I'm signing up for</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'personal', label: 'Personal use', desc: 'Chat & call friends and family', icon: Heart },
                { id: 'workspace', label: 'Workspace / Team', desc: 'For your company or organization', icon: Building2 },
              ].map((opt) => {
                const Icon = opt.icon;
                const active = accountType === opt.id;
                return (
                  <button
                    type="button"
                    key={opt.id}
                    onClick={() => setAccountType(opt.id)}
                    aria-pressed={active}
                    className={cn(
                      'ring-brand rounded-2xl border p-3 text-left transition-colors',
                      active ? 'border-brand-500 bg-brand-500/10' : 'border-border hover:bg-content/5'
                    )}
                  >
                    <span className={cn('inline-grid h-8 w-8 place-items-center rounded-xl', active ? 'bg-brand-gradient text-white' : 'bg-content/5 text-content-muted')}>
                      <Icon size={16} />
                    </span>
                    <p className="mt-1.5 text-sm font-semibold text-content">{opt.label}</p>
                    <p className="text-[11px] leading-snug text-content-muted">{opt.desc}</p>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-content-muted">
              {accountType === 'personal'
                ? 'You’ll connect with other personal users by their email or username.'
                : 'You’ll get your own private workspace — only its members can reach each other.'}
            </p>
          </motion.div>
        )}

        <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
          {/* Optional profile photo */}
          <motion.div variants={rise} className="flex items-center gap-4">
            <div className="relative">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="ring-brand group relative grid h-16 w-16 place-items-center overflow-hidden rounded-full border border-border bg-surface-2 transition-transform hover:scale-105"
                aria-label="Add profile photo"
              >
                {avatar ? (
                  <img src={avatar} alt="Profile preview" className="h-full w-full object-cover" />
                ) : (
                  <Camera size={20} className="text-content-muted transition-colors group-hover:text-content" />
                )}
              </button>
              {avatar && (
                <button
                  type="button"
                  onClick={() => setAvatar(null)}
                  aria-label="Remove photo"
                  className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-red-500 text-white shadow transition-transform hover:scale-110"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-content">Profile photo</p>
              <p className="text-xs text-content-muted">Optional — you can add one later.</p>
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={pickPhoto} className="hidden" />
          </motion.div>

          <motion.div variants={rise}>
            <Field label="Full name" hint={fieldError('name')}>
              <Input
                icon={User}
                type="text"
                autoComplete="name"
                placeholder="Ada Lovelace"
                value={form.name}
                onChange={set('name')}
                onBlur={blur('name')}
                className={cn(fieldError('name') && 'border-red-500/70 focus-visible:ring-red-500/40')}
              />
            </Field>
          </motion.div>

          {!inviteCode && accountType === 'workspace' && (
            <motion.div variants={rise}>
              <Field label="Workspace name" hint="Your team or company name — you can rename it later.">
                <Input
                  icon={Building2}
                  type="text"
                  placeholder={form.name.trim() ? `${form.name.trim()}'s workspace` : 'My workspace'}
                  value={form.workspaceName}
                  onChange={set('workspaceName')}
                />
              </Field>
            </motion.div>
          )}

          <motion.div variants={rise}>
            <Field label="Email address" hint={fieldError('email')}>
              <Input
                icon={Mail}
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={set('email')}
                onBlur={blur('email')}
                className={cn(fieldError('email') && 'border-red-500/70 focus-visible:ring-red-500/40')}
              />
            </Field>
          </motion.div>

          <motion.div variants={rise}>
            <Field label="Password" hint={fieldError('password')}>
              <div className="relative">
                <Input
                  icon={Lock}
                  type={showPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Create a password (8+ characters)"
                  className={cn('pr-11', fieldError('password') && 'border-red-500/70 focus-visible:ring-red-500/40')}
                  value={form.password}
                  onChange={set('password')}
                  onBlur={blur('password')}
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

            {/* Strength meter */}
            {form.password && (
              <div className="mt-2 flex items-center gap-3">
                <div className="flex flex-1 gap-1.5">
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className={cn(
                        'h-1.5 flex-1 rounded-full transition-colors',
                        i < strength ? strengthColors[strength] : 'bg-border'
                      )}
                    />
                  ))}
                </div>
                <span className="w-16 text-right text-xs font-medium text-content-muted">
                  {strengthLabels[strength]}
                </span>
              </div>
            )}
          </motion.div>

          <motion.div variants={rise}>
            <Field label="Confirm password" hint={fieldError('confirmPassword')}>
              <Input
                icon={Lock}
                type={showPw ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="Re-enter your password"
                value={form.confirmPassword}
                onChange={set('confirmPassword')}
                onBlur={blur('confirmPassword')}
                className={cn(fieldError('confirmPassword') && 'border-red-500/70 focus-visible:ring-red-500/40')}
              />
            </Field>
          </motion.div>

          <motion.div variants={rise} className="pt-1">
            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 size={18} className="animate-spin" /> Creating account…
                </>
              ) : (
                <>
                  Create account <ArrowRight size={18} />
                </>
              )}
            </Button>
          </motion.div>
        </form>

        <motion.p variants={rise} className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-content-muted">
          <Check size={13} className="text-emerald-500" />
          By continuing you agree to our Terms &amp; Privacy Policy.
        </motion.p>

        <motion.p variants={rise} className="mt-4 text-center text-sm text-content-muted">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-brand-600 transition-colors hover:text-brand-500 dark:text-brand-300">
            Sign in
          </Link>
        </motion.p>
      </AuthPanel>
    </motion.div>
  );
}
