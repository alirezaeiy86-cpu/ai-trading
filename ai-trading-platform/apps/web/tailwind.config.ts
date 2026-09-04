import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Trading platform color system
        profit: {
          DEFAULT: '#22c55e',
          dark: '#16a34a',
        },
        loss: {
          DEFAULT: '#ef4444',
          dark: '#dc2626',
        },
        neutral: {
          trading: '#94a3b8',
        },
      },
    },
  },
  plugins: [],
};

export default config;
