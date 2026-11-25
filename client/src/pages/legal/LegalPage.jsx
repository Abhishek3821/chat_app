import { useEffect } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { LogoFull } from '@/components/brand/Logo';

export function LegalLinks({ className = '' }) {
  const linkClass = 'ring-brand rounded-lg px-2 py-3 transition-colors hover:text-brand-600 dark:hover:text-brand-300';
  return (
    <nav aria-label="Privacy and account information" className={`flex flex-wrap items-center justify-center gap-x-3 text-sm text-content-muted ${className}`}>
      <NavLink to="/privacy-policy" className={linkClass}>Privacy Policy</NavLink>
      <NavLink to="/delete-account" className={linkClass}>Delete Account</NavLink>
    </nav>
  );
}

export default function LegalPage({ title, children }) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} | ChatKonect`;
    window.scrollTo(0, 0);
    return () => { document.title = previousTitle; };
  }, [title]);

  return (
    <div className="min-h-[100dvh] bg-[rgb(var(--app-bg))] text-content">
      <header className="border-b border-border bg-surface/80">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-5 sm:px-8">
          <Link to="/login" aria-label="ChatKonect sign in" className="ring-brand rounded-lg"><LogoFull /></Link>
          <LegalLinks />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
        <Link to="/login" className="ring-brand inline-flex items-center gap-2 rounded-lg py-3 text-sm font-semibold text-brand-600 dark:text-brand-300">
          <ArrowLeft size={16} /> Back to sign in
        </Link>
        <article className="mt-5 rounded-3xl border border-border bg-surface p-6 shadow-soft sm:p-10">
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
          <div className="mt-6 space-y-5 text-sm leading-7 text-content-muted sm:text-base [&_h2]:pt-4 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-content [&_h3]:font-semibold [&_h3]:text-content [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6 [&_strong]:font-semibold [&_strong]:text-content [&_a]:font-semibold [&_a]:text-brand-600 [&_a]:underline dark:[&_a]:text-brand-300">
            {children}
          </div>
        </article>
      </main>
      <footer className="mx-auto max-w-3xl px-5 pb-8 text-center text-xs text-content-muted">
        <LegalLinks className="mb-3" />
        <p>© {new Date().getFullYear()} ChatKonect. Crafted for real connection.</p>
      </footer>
    </div>
  );
}
