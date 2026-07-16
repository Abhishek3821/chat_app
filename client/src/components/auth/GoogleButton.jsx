import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '@/store/useAuth';

// Configured via VITE_GOOGLE_CLIENT_ID. When it's absent the button renders
// nothing, so the app works fine without Google set up.
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

let gsiPromise = null;
function loadGsi() {
  if (typeof window !== 'undefined' && window.google?.accounts?.id) return Promise.resolve();
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load Google sign-in.'));
    document.head.appendChild(s);
  });
  return gsiPromise;
}

/** Renders the official Google Identity Services button (sign in OR sign up). */
export default function GoogleButton({ text = 'continue_with' }) {
  const ref = useRef(null);
  const navigate = useNavigate();
  const googleAuth = useAuth((s) => s.googleAuth);

  useEffect(() => {
    if (!CLIENT_ID) return undefined;
    let cancelled = false;
    loadGsi()
      .then(() => {
        if (cancelled || !window.google?.accounts?.id || !ref.current) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: async (resp) => {
            try {
              const user = await googleAuth(resp.credential);
              toast.success(`Welcome, ${user?.name?.split(' ')[0] || 'friend'}!`);
              navigate('/');
            } catch (err) {
              toast.error(err?.message || 'Google sign-in failed.');
            }
          },
        });
        ref.current.innerHTML = '';
        window.google.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', width: 320, text, shape: 'pill', logo_alignment: 'center' });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [googleAuth, navigate, text]);

  if (!CLIENT_ID) return null;
  return (
    <div className="mt-6">
      <div className="mb-4 flex items-center gap-3 text-xs font-medium text-content-muted">
        <span className="h-px flex-1 bg-border" /> OR <span className="h-px flex-1 bg-border" />
      </div>
      <div className="flex justify-center" ref={ref} />
    </div>
  );
}
