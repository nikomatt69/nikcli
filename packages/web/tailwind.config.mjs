/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Space Grotesk", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      colors: {
        terminal: {
          bg: "rgb(var(--terminal-bg) / <alpha-value>)",
          panel: "rgb(var(--terminal-panel) / <alpha-value>)",
          border: "rgb(var(--terminal-border) / <alpha-value>)",
          text: "rgb(var(--terminal-text) / <alpha-value>)",
          muted: "rgb(var(--terminal-muted) / <alpha-value>)",
          accent: "rgb(var(--terminal-accent) / <alpha-value>)",
          error: "rgb(var(--terminal-error) / <alpha-value>)",
          warning: "rgb(var(--terminal-warning) / <alpha-value>)",
          code: "rgb(var(--terminal-code) / <alpha-value>)",
          'window-bg': "rgb(var(--terminal-window-bg) / <alpha-value>)",
          'window-border': "rgb(var(--terminal-window-border) / <alpha-value>)",
          'window-text': "rgb(var(--terminal-window-text) / <alpha-value>)",
          'window-code': "rgb(var(--terminal-window-code) / <alpha-value>)",
        },
        surface: {
          hover: "var(--surface-hover)",
          active: "var(--surface-active)",
          strong: "var(--surface-strong)",
        }
      },
      boxShadow: {
        soft: "var(--shadow-soft)",
        strong: "var(--shadow-strong)",
        glow: "var(--shadow-glow)",
      },
      animation: {
        cursor: "cursor 1s step-end infinite",
        'fade-in-up': "fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        'pulse-slow': "pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      keyframes: {
        cursor: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        fadeInUp: {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      typography: (theme) => ({
        invert: {
          css: {
            '--tw-prose-body': theme('colors.terminal.text'),
            '--tw-prose-headings': theme('colors.terminal.text'),
            '--tw-prose-lead': theme('colors.terminal.muted'),
            '--tw-prose-links': theme('colors.terminal.text'),
            '--tw-prose-bold': theme('colors.terminal.text'),
            '--tw-prose-counters': theme('colors.terminal.muted'),
            '--tw-prose-bullets': theme('colors.terminal.muted'),
            '--tw-prose-hr': theme('colors.terminal.border'),
            '--tw-prose-quotes': theme('colors.terminal.muted'),
            '--tw-prose-quote-borders': theme('colors.terminal.border'),
            '--tw-prose-captions': theme('colors.terminal.muted'),
            '--tw-prose-code': theme('colors.terminal.text'),
            '--tw-prose-pre-code': theme('colors.terminal.text'),
            '--tw-prose-pre-bg': theme('colors.terminal.code'),
            '--tw-prose-th-borders': theme('colors.terminal.border'),
            '--tw-prose-td-borders': theme('colors.terminal.border'),
          },
        },
        DEFAULT: {
          css: {
            '--tw-prose-body': theme('colors.terminal.text'),
            '--tw-prose-headings': theme('colors.terminal.text'),
            '--tw-prose-lead': theme('colors.terminal.muted'),
            '--tw-prose-links': theme('colors.terminal.text'),
            '--tw-prose-bold': theme('colors.terminal.text'),
            '--tw-prose-counters': theme('colors.terminal.muted'),
            '--tw-prose-bullets': theme('colors.terminal.muted'),
            '--tw-prose-hr': theme('colors.terminal.border'),
            '--tw-prose-quotes': theme('colors.terminal.muted'),
            '--tw-prose-quote-borders': theme('colors.terminal.border'),
            '--tw-prose-captions': theme('colors.terminal.muted'),
            '--tw-prose-code': theme('colors.terminal.text'),
            '--tw-prose-pre-code': theme('colors.terminal.text'),
            '--tw-prose-pre-bg': theme('colors.terminal.code'),
            '--tw-prose-th-borders': theme('colors.terminal.border'),
            '--tw-prose-td-borders': theme('colors.terminal.border'),
            maxWidth: 'none',
            color: 'var(--tw-prose-body)',
            lineHeight: '1.75',
            a: {
              color: 'var(--tw-prose-links)',
              textDecoration: 'underline',
              fontWeight: '500',
              textDecorationColor: theme('colors.terminal.border'),
              '&:hover': {
                color: theme('colors.terminal.accent'),
                textDecorationColor: theme('colors.terminal.accent'),
              },
            },
            code: {
              color: 'var(--tw-prose-code)',
              backgroundColor: theme('colors.terminal.panel'),
              padding: '0.25rem 0.375rem',
              borderRadius: '0.375rem',
              fontWeight: '500',
              border: `1px solid ${theme('colors.terminal.border')}`,
            },
            'code::before': {
              content: '""',
            },
            'code::after': {
              content: '""',
            },
            pre: {
              backgroundColor: 'var(--tw-prose-pre-bg)',
              color: 'var(--tw-prose-pre-code)',
              overflowX: 'auto',
              fontWeight: '400',
              border: `1px solid ${theme('colors.terminal.border')}`,
            },
            h1: {
              fontWeight: '800',
              letterSpacing: '-0.025em',
            },
            h2: {
              fontWeight: '700',
              letterSpacing: '-0.025em',
              marginTop: '2em',
              marginBottom: '1em',
            },
            h3: {
              fontWeight: '600',
              marginTop: '1.5em',
              marginBottom: '0.75em',
            },
          },
        },
      }),
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
