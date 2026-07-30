/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
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
        violet: {
          500: '#8b5cf6', // secondary
          600: '#7c3aed',
        },
        fuchsia: {
          500: '#d946ef',
          600: '#c026d3',
        },
        cyan: {
          400: '#22d3ee',
          500: '#06b6d4', // accent
          600: '#0891b2',
        },
        navy: {
          800: '#131a2f',
          900: '#0f172a', // dark background
          950: '#0a0f1e',
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
        soft: '0 4px 24px -8px rgb(15 23 42 / 0.1)',
        'soft-lg': '0 12px 40px -12px rgb(15 23 42 / 0.18)',
        // Flat design: "glow" is now just a quiet neutral lift, no colour halo.
        glow: '0 2px 8px -2px rgb(17 24 39 / 0.12)',
        'glow-lg': '0 6px 20px -6px rgb(17 24 39 / 0.16)',
        'glow-cyan': '0 2px 8px -2px rgb(17 24 39 / 0.12)',
      },
      backgroundImage: {
        // Flattened to a solid accent so the UI reads clean, not gradient.
        'brand-gradient': 'linear-gradient(rgb(var(--brand-600)), rgb(var(--brand-600)))',
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
