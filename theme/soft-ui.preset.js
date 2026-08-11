/**
 * Soft-UI theme — Tailwind CSS v3 preset.
 *
 * Pairs with ./soft-ui.css, which defines the CSS variables every token below
 * resolves through. Neither half works alone.
 *
 *   // tailwind.config.js
 *   module.exports = {
 *     presets: [require('./theme/soft-ui.preset.js')],
 *     content: ['./index.html', './src/**\/*.{js,jsx,ts,tsx}'],
 *   };
 *
 * Why variables instead of literal hex values: light mode, dark mode and six
 * accent presets all share one set of class names. `bg-surface` is white in
 * light mode and navy in dark mode without a single `dark:` variant at the call
 * site, and the accent can be swapped at runtime by setting one attribute.
 */
module.exports = {
  darkMode: 'class',
  theme: {
    /* Declared in FULL, not via `extend`, so the media queries emit in ascending
       order. Appending `xs` through `extend` places it AFTER `2xl` in the
       stylesheet, which lets `xs:` silently beat `2xl:` on wide screens. */
    screens: {
      xs: '475px', // small/older phones (iPhone SE is 375px)
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
    extend: {
      colors: {
        /* Accent ramp. Re-pointed at runtime by [data-accent] in the CSS. */
        brand: {
          50: 'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)',
        },
        /* Semantic surfaces and ink — these are what you should reach for
           instead of `bg-white dark:bg-slate-900`. */
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        content: 'rgb(var(--content) / <alpha-value>)',
        'content-muted': 'rgb(var(--content-muted) / <alpha-value>)',
        /* Theme-aware chart ink (see the note in soft-ui.css). */
        chart: { 1: 'rgb(var(--chart-1) / <alpha-value>)' },

        /* NOTE — the source project also REMAPPED Tailwind's built-in `cyan`,
           `violet` and `fuchsia` onto its own palette. That is deliberately NOT
           carried over: it caused a real bug there (a "blue" read-receipt tick
           written as `text-cyan-200` silently rendered mint, so the state change
           was invisible). Keep Tailwind's defaults meaning what they say, and
           put brand colours on `brand-*`. */
      },

      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
      },

      /* Softer than Tailwind's defaults — a soft-UI needs generous radii or the
         shadow pair looks like a bevel on a box rather than a moulded surface. */
      borderRadius: {
        xl: '1rem',
        '2xl': '1.25rem',
        '3xl': '1.75rem',
        '4xl': '2.25rem',
      },

      /* Shadows resolve through the SAME --neu-* vars as the .neu-* classes, so
         `shadow-soft` is correct in both themes automatically. Dark mode needs a
         much stronger, near-black cast plus a light bloom on the lit side, or a
         raised surface reads flat. */
      boxShadow: {
        soft:
          '0 4px 20px -8px rgb(var(--neu-lo) / var(--neu-lo-a)), inset 0 1px 0 rgb(var(--neu-edge) / var(--neu-edge-a))',
        'soft-lg':
          '0 14px 36px -14px rgb(var(--neu-lo) / var(--neu-lo-a-strong)), -6px -6px 18px -12px rgb(var(--neu-hi) / var(--neu-hi-a)), inset 0 1px 0 rgb(var(--neu-edge) / var(--neu-edge-a))',
        /* Tight tactile lift with a bevelled top edge — for small controls and
           anything sitting on an accent fill. No colour halo. */
        glow: '0 3px 9px -4px rgb(var(--neu-lo) / var(--neu-lo-a-strong)), inset 0 1px 0 rgb(255 255 255 / 0.22)',
        'glow-lg': '0 8px 20px -8px rgb(var(--neu-lo) / var(--neu-lo-a-strong)), inset 0 1px 0 rgb(255 255 255 / 0.26)',
      },

      backgroundImage: {
        /* Moulded accent, not a flat sticker: a specular sheen over the top ~55%
           (first layer paints above the fill) and a ramp from --accent-fill down
           to the deeper --accent-fill-2. Both stops resolve per theme AND per
           accent preset. Used by `.btn-accent` and any active/selected state. */
        'brand-gradient':
          'linear-gradient(180deg, rgb(255 255 255 / var(--gloss-a)) 0%, rgb(255 255 255 / calc(var(--gloss-a) * 0.22)) 46%, rgb(255 255 255 / 0) 56%), linear-gradient(180deg, rgb(var(--accent-fill)), rgb(var(--accent-fill-2)))',
        /* A 10% accent tint — for subtle selected rows and badge backgrounds. */
        'brand-gradient-soft': 'linear-gradient(rgb(var(--brand-500) / 0.1), rgb(var(--brand-500) / 0.1))',
      },

      keyframes: {
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '70%': { transform: 'scale(1.6)', opacity: '0' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%, 60%': { transform: 'translateX(-6px)' },
          '40%, 80%': { transform: 'translateX(6px)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        shimmer: 'shimmer 1.6s infinite',
        float: 'float 6s ease-in-out infinite',
        'pulse-ring': 'pulse-ring 1.8s cubic-bezier(0.4,0,0.6,1) infinite',
        shake: 'shake 0.4s ease-in-out',
      },
    },
  },
  plugins: [],
};
