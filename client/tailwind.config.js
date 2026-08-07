/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    // Declared in full (not via `extend`) so the media queries emit in
    // ascending order. Appending `xs` through `extend` would place it AFTER
    // `2xl` in the stylesheet, letting `xs:` silently beat `2xl:` on wide
    // screens. `xs` targets small/older phones (iPhone SE is 375px wide).
    screens: {
      xs: '475px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
    extend: {
      colors: {
        // Brand palette — driven by CSS variables (see index.css) so the
        // Appearance → Accent color picker recolors the whole app at runtime.
        brand: {
          50: 'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)', // primary
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)',
        },
        // ── Palette-aligned overrides ────────────────────────────────
        // These four names predate the brand-token system and are used
        // directly in ~18 files (immersive call/meeting surfaces, tooltips,
        // code blocks, badges). Re-pointing them into the #0C2C47/#2D5652/
        // #97D3CD/#E4F2EA palette re-themes all of those call sites without
        // touching each one. Kept under the original names so the existing
        // markup keeps working; they are NOT accent-swappable (deliberate —
        // immersive video surfaces should stay navy at every accent).
        violet: {
          300: '#96becd', // dusk blue-teal, readable on navy
          500: '#3d6a80', // deepest palette-adjacent blue
          600: '#2e566a',
        },
        fuchsia: {
          500: '#4a7f86', // folded into the teal family
          600: '#3a666f',
        },
        cyan: {
          100: '#dff3f0', // code-block ink on navy
          200: '#bee6e2',
          300: '#97d3cd', // #97D3CD palette mint
          400: '#74beb8',
          500: '#3c8c86', // 4.0:1 on white for small icons/checks
          600: '#2d7670',
        },
        navy: {
          800: '#123857', // raised panel on immersive surfaces
          900: '#0c2c47', // #0C2C47 palette navy
          950: '#061a2a', // deepest - video/canvas backdrop
        },
        // New name (no Tailwind default to partially shadow) for the pale end
        // of the palette. The teal end is already covered by `brand-600/700`.
        mint: {
          50: '#e4f2ea', // #E4F2EA palette pale mint
          100: '#d0ebe3',
          200: '#b3e0d9',
          300: '#97d3cd', // #97D3CD palette mint
        },
        // Semantic tokens driven by CSS variables (see index.css)
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        content: 'rgb(var(--content) / <alpha-value>)',
        'content-muted': 'rgb(var(--content-muted) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.25rem',
        '3xl': '1.75rem',
        '4xl': '2.25rem',
      },
      boxShadow: {
        // Every shadow resolves through the soft-UI vars (--neu-lo / --neu-hi /
        // --neu-edge, see index.css) rather than a literal navy: the dark theme
        // needs a much stronger, near-black cast than the light one, and a
        // matching light bloom on the lit side, or a raised surface reads flat.
        soft: '0 4px 20px -8px rgb(var(--neu-lo) / var(--neu-lo-a)), inset 0 1px 0 rgb(var(--neu-edge) / var(--neu-edge-a))',
        'soft-lg':
          '0 14px 36px -14px rgb(var(--neu-lo) / var(--neu-lo-a-strong)), -6px -6px 18px -12px rgb(var(--neu-hi) / var(--neu-hi-a)), inset 0 1px 0 rgb(var(--neu-edge) / var(--neu-edge-a))',
        // "glow" is a tight tactile lift with a bevelled top edge — no colour halo.
        glow: '0 3px 9px -4px rgb(var(--neu-lo) / var(--neu-lo-a-strong)), inset 0 1px 0 rgb(255 255 255 / 0.22)',
        'glow-lg':
          '0 8px 20px -8px rgb(var(--neu-lo) / var(--neu-lo-a-strong)), inset 0 1px 0 rgb(255 255 255 / 0.26)',
        'glow-cyan': '0 3px 9px -4px rgb(var(--neu-lo) / var(--neu-lo-a-strong)), inset 0 1px 0 rgb(255 255 255 / 0.22)',
      },
      backgroundImage: {
        // Moulded accent, not a flat sticker: a specular sheen over the top
        // ~55% (first layer, so it paints above the fill) and a ramp from
        // --accent-fill down to the deeper --accent-fill-2. Both stops resolve
        // per theme AND per accent preset — see the notes in index.css.
        'brand-gradient':
          'linear-gradient(180deg, rgb(255 255 255 / var(--gloss-a)) 0%, rgb(255 255 255 / calc(var(--gloss-a) * 0.22)) 46%, rgb(255 255 255 / 0) 56%), linear-gradient(180deg, rgb(var(--accent-fill)), rgb(var(--accent-fill-2)))',
        'brand-gradient-soft': 'linear-gradient(rgb(var(--brand-500) / 0.1), rgb(var(--brand-500) / 0.1))',
        'mesh-dark': 'none',
        'mesh-light': 'none',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '70%': { transform: 'scale(1.6)', opacity: '0' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%, 60%': { transform: 'translateX(-6px)' },
          '40%, 80%': { transform: 'translateX(6px)' },
        },
        'float-up': {
          '0%': { transform: 'translateY(0) scale(0.6)', opacity: '0' },
          '15%': { transform: 'translateY(-10px) scale(1.1)', opacity: '1' },
          '100%': { transform: 'translateY(-90px) scale(1)', opacity: '0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'pulse-ring': 'pulse-ring 1.8s cubic-bezier(0.4,0,0.6,1) infinite',
        shimmer: 'shimmer 1.6s infinite',
        float: 'float 6s ease-in-out infinite',
        shake: 'shake 0.4s ease-in-out',
        'float-up': 'float-up 4s ease-out forwards',
      },
    },
  },
  plugins: [],
};
