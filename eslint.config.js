const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'warn',
    },
  },
);
