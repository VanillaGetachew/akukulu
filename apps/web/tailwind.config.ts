import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: 'rgb(var(--ink) / <alpha-value>)',
        night: 'rgb(var(--night) / <alpha-value>)',
        panel: 'rgb(var(--panel) / <alpha-value>)',
        panel2: 'rgb(var(--panel-2) / <alpha-value>)',
        charcoal: 'rgb(var(--charcoal) / <alpha-value>)',
        line: 'var(--line)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        lime: 'rgb(var(--lime) / <alpha-value>)',
        limeDeep: 'rgb(var(--lime-deep) / <alpha-value>)',
        gold: 'rgb(var(--gold) / <alpha-value>)',
        goldDeep: 'rgb(var(--gold-deep) / <alpha-value>)',
        ivory: 'rgb(var(--ivory) / <alpha-value>)',
        lineStrong: 'var(--line-strong)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        violet: 'rgb(var(--violet) / <alpha-value>)',
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
        ethiopic: ['var(--font-ethiopic)', 'var(--font-body)', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(34,212,138,.35), 0 8px 30px -8px rgba(34,212,138,.45)',
        card: '0 10px 30px -12px rgba(0,0,0,.65)',
        lift: '0 18px 40px -18px rgba(0,0,0,.8)',
      },
      // Layers: page chrome 30, full-screen tables 35, overlays 40–45, toasts 50.
      zIndex: { nav: '30', table: '35', overlay: '40', modal: '45', toast: '50' },
      keyframes: {
        dealIn: { '0%': { transform: 'translateY(-24px) rotate(-8deg) scale(.9)', opacity: '0' }, '100%': { transform: 'none', opacity: '1' } },
        pop: { '0%': { transform: 'scale(.6)' }, '60%': { transform: 'scale(1.12)' }, '100%': { transform: 'scale(1)' } },
        roll: { '0%': { transform: 'rotate(0)' }, '100%': { transform: 'rotate(360deg)' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        pulseRing: { '0%': { boxShadow: '0 0 0 0 rgba(34,212,138,.6)' }, '100%': { boxShadow: '0 0 0 10px rgba(34,212,138,0)' } },
        rise: { '0%': { transform: 'translateY(8px)', opacity: '0' }, '100%': { transform: 'none', opacity: '1' } },
      },
      animation: {
        dealIn: 'dealIn .35s cubic-bezier(.2,.8,.2,1) both',
        pop: 'pop .3s ease-out both',
        roll: 'roll .85s linear infinite',
        shimmer: 'shimmer 1.6s linear infinite',
        pulseRing: 'pulseRing 1.2s ease-out infinite',
        rise: 'rise .32s cubic-bezier(.2,.8,.2,1) both',
      },
    },
  },
  plugins: [],
} satisfies Config;
