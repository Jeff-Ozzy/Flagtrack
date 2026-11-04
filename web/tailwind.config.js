/** Colors come from CSS variables in src/index.css (design tokens). */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        surface2: token('surface-2'),
        line: token('line'),
        text: token('text'),
        muted: token('muted'),
        accent: token('accent'),
        'accent-ink': token('accent-ink'),
        flame: token('flame'),
        danger: token('danger'),
        success: token('success'),
        info: token('info'),
        warn: token('warn'),
      },
      fontFamily: {
        display: ['"Saira Condensed"', 'system-ui', 'sans-serif'],
        brand: ['Saira', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: { xl: '14px', '2xl': '20px' },
      keyframes: {
        pop: { '0%': { transform: 'scale(.6)', opacity: 0 }, '60%': { transform: 'scale(1.08)', opacity: 1 }, '100%': { transform: 'scale(1)' } },
        rise: { '0%': { transform: 'translateY(12px)', opacity: 0 }, '100%': { transform: 'translateY(0)', opacity: 1 } },
        flicker: { '0%,100%': { transform: 'scale(1) rotate(-2deg)' }, '50%': { transform: 'scale(1.08) rotate(2deg)' } },
        burst: { '0%': { transform: 'translate(0,0) scale(1)', opacity: 1 }, '100%': { transform: 'translate(var(--dx), var(--dy)) scale(.3)', opacity: 0 } },
        shimmer: { '0%': { backgroundPosition: '-400px 0' }, '100%': { backgroundPosition: '400px 0' } },
      },
      animation: {
        pop: 'pop .45s cubic-bezier(.2,.9,.3,1.3) both',
        rise: 'rise .35s ease-out both',
        flicker: 'flicker 1.6s ease-in-out infinite',
        burst: 'burst .9s ease-out forwards',
        shimmer: 'shimmer 1.4s linear infinite',
      },
    },
  },
  plugins: [],
};
