import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      typography: {
        DEFAULT: {
          css: {
            maxWidth: 'none',
            color: '#374151',
            a: {
              color: '#2563eb',
              '&:hover': {
                color: '#1d4ed8',
              },
            },
            h1: {
              color: '#111827',
              fontWeight: '700',
            },
            h2: {
              color: '#111827',
              fontWeight: '600',
            },
            h3: {
              color: '#111827',
              fontWeight: '600',
            },
            h4: {
              color: '#111827',
              fontWeight: '600',
            },
            h5: {
              color: '#111827',
              fontWeight: '600',
            },
            h6: {
              color: '#111827',
              fontWeight: '600',
            },
            strong: {
              color: '#111827',
              fontWeight: '600',
            },
            code: {
              color: '#111827',
              backgroundColor: '#f3f4f6',
              padding: '0.25rem 0.375rem',
              borderRadius: '0.25rem',
              fontWeight: '500',
            },
            'code::before': {
              content: '""',
            },
            'code::after': {
              content: '""',
            },
            table: {
              width: '100%',
              borderCollapse: 'collapse',
              margin: '1.5rem 0',
              fontSize: '0.875rem',
              lineHeight: '1.5',
            },
            'table th': {
              backgroundColor: '#f9fafb',
              border: '1px solid #d1d5db',
              padding: '0.75rem',
              textAlign: 'left',
              fontWeight: '600',
              color: '#111827',
            },
            'table td': {
              border: '1px solid #d1d5db',
              padding: '0.75rem',
              textAlign: 'left',
              color: '#374151',
            },
            'table tr:nth-child(even)': {
              backgroundColor: '#f9fafb',
            },
            'table tr:hover': {
              backgroundColor: '#f3f4f6',
            },
          },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};

export default config; 