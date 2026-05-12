import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
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
