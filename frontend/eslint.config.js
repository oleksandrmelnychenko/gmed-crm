import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Native mobile toolchains copy third-party bridge bundles into generated
  // build directories. They are not application source and may contain rule
  // directives for plugins that GMED does not install.
  globalIgnores(['dist', 'android/**/build/**', 'ios/**/build/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'react-refresh/only-export-components': 'off',
      'react-hooks/exhaustive-deps': 'off',
      // React Hooks 7 adds compiler diagnostics to its recommended preset.
      // The current application has not enabled the React Compiler yet; keep
      // the established Rules of Hooks gate while that migration is handled
      // separately from release stabilization.
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    // GMED works in German time only: every date and time is formatted in
    // Europe/Berlin, whatever time zone the browser runs in. Intl date
    // formatters and Date#toLocale(Date|Time)String default to the browser
    // zone, so they go through the app time-zone helpers instead.
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/lib/app-time-zone.ts',
      'src/lib/intl-cache.ts',
      'src/**/*.test.{ts,tsx}',
    ],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Intl',
          property: 'DateTimeFormat',
          message:
            'Use appDateTimeFormat from @/lib/app-time-zone (German time, Europe/Berlin).',
        },
        {
          property: 'toLocaleDateString',
          message:
            'Use appDateTimeFormat(locale, options).format(date) from @/lib/app-time-zone (German time, Europe/Berlin).',
        },
        {
          property: 'toLocaleTimeString',
          message:
            'Use appDateTimeFormat(locale, options).format(date) from @/lib/app-time-zone (German time, Europe/Berlin).',
        },
      ],
    },
  },
  {
    // The stock dayjs adapter takes "today" from the browser's day; the date
    // pickers get theirs from AppAdapterDayjs. no-restricted-syntax rather than
    // no-restricted-imports, which the staff-navigation block below overrides.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/app-date-adapter.ts', 'src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportDeclaration[source.value='@mui/x-date-pickers/AdapterDayjs']",
          message:
            'Use AppAdapterDayjs from @/lib/app-date-adapter: the date pickers mark the Berlin date as today.',
        },
      ],
    },
  },
  {
    files: ['src/pages/**/*.tsx', 'src/components/**/*.tsx'],
    ignores: [
      'src/pages/login.tsx',
      'src/pages/patient-dashboard.tsx',
      'src/pages/patient-invoices.tsx',
      'src/pages/patient-appointments.tsx',
      'src/pages/patient-documents.tsx',
      'src/pages/patient-privacy.tsx',
      'src/pages/patient-services.tsx',
      'src/components/staff-link.tsx',
      'src/components/topbar.tsx',
      'src/components/nav-panel.tsx',
      'src/components/layout.tsx',
      'src/components/ui/**',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-router-dom',
              importNames: ['useNavigate'],
              message:
                'Use useStaffNavigate from @/lib/use-staff-navigate instead of useNavigate() for in-app staff navigation.',
            },
            {
              name: 'react-router-dom',
              importNames: ['Link'],
              message:
                'Use StaffLink from @/components/staff-link for in-app staff links (RBAC).',
            },
          ],
        },
      ],
    },
  },
])
