/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Primary — ocean teal: trust, safety, stability (used by crisis services, 211, hospitals)
        ocean: {
          50:  '#EFF9FB',
          100: '#D5EFF5',
          200: '#AADEED',
          300: '#72C8E2',
          400: '#38AED2',
          500: '#1A93BB',
          600: '#1A7A9A',  // primary interactive
          700: '#155F79',
          800: '#0F4259',
          900: '#0A2A3D',
          950: '#061825',
        },
        // Secondary — sage green: calm, healing, hope (nature, growth)
        sage: {
          50:  '#F0F7F4',
          100: '#D9EDE6',
          200: '#B4DBCD',
          300: '#80C0AA',
          400: '#4EA086',
          500: '#3A8A71',  // primary sage
          600: '#2E6E59',
          700: '#255748',
          800: '#1D4238',
          900: '#142E28',
          950: '#0B1E1A',
        },
        // Neutral warm slate — professional but not cold
        slate: {
          50:  '#F5F7F8',
          100: '#E9EDF0',
          200: '#D0D8DE',
          300: '#B0BDC7',
          400: '#8A9BAA',
          500: '#677D8E',
          600: '#506170',
          700: '#3D4D59',
          800: '#2A3540',
          900: '#1A2330',
          950: '#0F1720',
        },
        // Warm amber — used sparingly for CTAs only (not alerts)
        amber: {
          100: '#FEF3C7',
          400: '#FBBF24',
          500: '#D97706',
          600: '#B45309',
        },
      },
      animation: {
        'spin-slow':    'spin 3s linear infinite',
        'pulse-gentle': 'pulse 3s ease-in-out infinite',
        'breathe':      'breathe 4s ease-in-out infinite',
        'wave':         'wave 1.4s ease-in-out infinite',
      },
      keyframes: {
        breathe: {
          '0%, 100%': { transform: 'scale(1)',    opacity: '0.6' },
          '50%':      { transform: 'scale(1.08)', opacity: '1'   },
        },
        wave: {
          '0%, 100%': { transform: 'scaleY(0.5)' },
          '50%':      { transform: 'scaleY(1.0)' },
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
