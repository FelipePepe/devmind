// Minimal ESLint flat config — permissive baseline so CI catches real errors
// (parse errors, undefined globals, unused imports) without forcing a refactor
// of the whole codebase. Tighten rule-by-rule as the team is ready.

import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.pnpm-store/**',
      'workspace/**',
      'data/**',
      '**/*.generated.*',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Existing code uses `any` in several boundary spots (JSON parsing,
      // SQLite row shapes, OllamaMessage). Surface them as warnings later.
      '@typescript-eslint/no-explicit-any': 'off',
      // `!` is used in tight LCS / known-shape code paths.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Convention: prefix unused vars with `_`.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // SQLite driver returns wide types we narrow ad-hoc.
      '@typescript-eslint/no-unsafe-function-type': 'off',
      // `Record<string, never>` is fine for empty bag shapes.
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  }
);
