// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const tseslint = require('typescript-eslint');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', 'coverage/*', 'reports/*', 'android/*', 'ios/*', 'scripts/*', 'eslint.config.js'] },
  { rules: { 'no-console': 'error' } },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { parser: tseslint.parser, parserOptions: { projectService: true, tsconfigRootDir: __dirname } },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: { '@typescript-eslint/no-floating-promises': 'error' },
  },
  { files: ['src/log/**'], rules: { 'no-console': 'off' } },
]);
