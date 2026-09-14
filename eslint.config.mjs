import js from '@eslint/js';
import globals from 'globals';
export default [
  { ignores: ['dist/**', 'local/**', 'generated/**', 'changes/**', '.venv/**', 'node_modules/**'] },
  js.configs.recommended,
  { files: ['**/*.mjs'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }], 'no-constant-binary-expression': 'error' } }
];
