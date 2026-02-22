import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Cores principais do Advogado Virtual
        primary: {
          50:  '#fff1f2',
          100: '#ffe4e6',
          200: '#fecdd3',
          300: '#fda4af',
          400: '#fb7185',
          500: '#f43f5e',
          600: '#e11d48',
          700: '#be123c',
          800: '#9f1239',
          900: '#881337',
          DEFAULT: '#9f1239',
          foreground: '#ffffff',
        },
        accent: {
          DEFAULT: '#d4a017',
          foreground: '#9f1239',
        },
        background: '#f8fafc',
        surface: '#ffffff',
        border: '#e2e8f0',
        muted: {
          DEFAULT: '#f1f5f9',
          foreground: '#64748b',
        },
        destructive: {
          DEFAULT: '#dc2626',
          foreground: '#ffffff',
        },
        success: {
          DEFAULT: '#16a34a',
          foreground: '#ffffff',
        },
        warning: {
          DEFAULT: '#d97706',
          foreground: '#ffffff',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      fontSize: {
        // Tamanhos maiores para melhor legibilidade (advogados seniores)
        'xs':   ['0.8125rem', { lineHeight: '1.25rem' }],  // 13px
        'sm':   ['0.9375rem', { lineHeight: '1.5rem' }],   // 15px
        'base': ['1rem',      { lineHeight: '1.625rem' }], // 16px
        'lg':   ['1.125rem',  { lineHeight: '1.75rem' }],  // 18px
        'xl':   ['1.25rem',   { lineHeight: '1.875rem' }], // 20px
        '2xl':  ['1.5rem',    { lineHeight: '2rem' }],     // 24px
        '3xl':  ['1.875rem',  { lineHeight: '2.375rem' }], // 30px
      },
      borderRadius: {
        lg: '0.5rem',
        md: '0.375rem',
        sm: '0.25rem',
      },
      boxShadow: {
        card: '0 1px 3px 0 rgba(0, 0, 0, 0.08), 0 1px 2px -1px rgba(0, 0, 0, 0.04)',
        'card-hover': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.06)',
      },
    },
  },
  plugins: [],
}

export default config
