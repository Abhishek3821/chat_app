/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Brand palette — deep navy, soft purple, electric blue
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1', // primary
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        violet: {
          500: '#8b5cf6', // secondary
          600: '#7c3aed',
        },
        cyan: {
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
      },
      boxShadow: {
        soft: '0 4px 24px -8px rgb(15 23 42 / 0.12)',
        'soft-lg': '0 12px 40px -12px rgb(15 23 42 / 0.25)',
        glow: '0 0 0 1px rgb(99 102 241 / 0.15), 0 8px 32px -8px rgb(99 102 241 / 0.35)',
        'glow-cyan': '0 8px 32px -8px rgb(6 182 212 / 0.45)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #06b6d4 100%)',
        'brand-gradient-soft': 'linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(139,92,246,0.10) 50%, rgba(6,182,212,0.10) 100%)',
        'mesh-dark': 'radial-gradient(at 0% 0%, rgba(99,102,241,0.18) 0px, transparent 50%), radial-gradient(at 100% 0%, rgba(6,182,212,0.14) 0px, transparent 50%), radial-gradient(at 100% 100%, rgba(139,92,246,0.16) 0px, transparent 50%)',
        'mesh-light': 'radial-gradient(at 0% 0%, rgba(99,102,241,0.10) 0px, transparent 50%), radial-gradient(at 100% 0%, rgba(6,182,212,0.08) 0px, transparent 50%), radial-gradient(at 100% 100%, rgba(139,92,246,0.08) 0px, transparent 50%)',
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
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'pulse-ring': 'pulse-ring 1.8s cubic-bezier(0.4,0,0.6,1) infinite',
        shimmer: 'shimmer 1.6s infinite',
        float: 'float 6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
