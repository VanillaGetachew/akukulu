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
        danger: 'rgb(var(--danger) / <alpha-value>)',
        violet: 'rgb(var(--violet) / <alpha-value>)',
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
        ethiopic: ['var(--font-ethiopic)', 'var(--font-body)', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(46,230,122,.35), 0 8px 30px -8px rgba(46,230,122,.45)',
        card: '0 10px 30px -12px rgba(0,0,0,.65)',
      },
      keyframes: {
        dealIn: { '0%': { transform: 'translateY(-24px) rotate(-8deg) scale(.9)', opacity: '0' }, '100%': { transform: 'none', opacity: '1' } },
        pop: { '0%': { transform: 'scale(.6)' }, '60%': { transform: 'scale(1.12)' }, '100%': { transform: 'scale(1)' } },
        roll: { '0%': { transform: 'rotate(0)' }, '100%': { transform: 'rotate(360deg)' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        pulseRing: { '0%': { boxShadow: '0 0 0 0 rgba(46,230,122,.6)' }, '100%': { boxShadow: '0 0 0 10px rgba(46,230,122,0)' } },
      },
      animation: {
        dealIn: 'dealIn .35s cubic-bezier(.2,.8,.2,1) both',
        pop: 'pop .3s ease-out both',
        roll: 'roll .5s linear infinite',
        shimmer: 'shimmer 1.6s linear infinite',
        pulseRing: 'pulseRing 1.2s ease-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
