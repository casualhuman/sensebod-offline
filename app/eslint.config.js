import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Things that do not exist on the Android 8 floor and have no polyfill in the build. */
const floorRules = {
  'no-restricted-globals': [
    'error',
    { name: 'structuredClone', message: 'Not on Android 8 (Chrome 98+).' },
    { name: 'ResizeObserver', message: 'Not on Android 8 (Chrome 64+). Use CSS, or check for it first.' },
    { name: 'BroadcastChannel', message: 'Check support first; avoid if possible.' },
  ],
  'no-restricted-syntax': [
    'error',
    { selector: "CallExpression[callee.property.name='replaceAll']", message: 'String.replaceAll is Chrome 85+. Use replace with a /g regular expression.' },
    { selector: "CallExpression[callee.property.name='at']", message: 'Array/String.at is Chrome 92+. Use an index.' },
    { selector: "CallExpression[callee.object.name='Object'][callee.property.name='fromEntries']", message: 'Object.fromEntries is Chrome 73+. Build the object in a loop.' },
  ],
};

/** Feature folders may use shared code only, never each other, never the mock. */
function boundaries(feature) {
  const others = ['learner', 'lessons', 'admin', 'games'].filter((name) => name !== feature);
  return {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          { group: ['@mock/*', '**/mock/**'], message: 'The mock API must never be imported by app code (tests excepted).' },
          { group: others.flatMap((name) => [`**/features/${name}/**`, `../${name}/**`]), message: 'Features do not import each other. Link with `paths`, share through src/shared (ask stream 1).' },
          { group: ['**/app/**'], message: 'Features do not import the app shell. Use src/shared.' },
        ],
      },
    ],
  };
}

export default tseslint.config(
  // public/games holds other projects' code, kept as they wrote it (docs/GAMES.md).
  { ignores: ['dist', 'coverage', 'node_modules', 'public/games'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'mock/**/*.ts'],
    languageOptions: { ecmaVersion: 2020, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // An error, and `useApi(load, deps)` is checked like useEffect: a missing
      // dependency there means a screen that keeps showing the old answer.
      'react-hooks/exhaustive-deps': ['error', { additionalHooks: '(useApi|useAdminApi)' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      ...floorRules,
    },
  },
  {
    files: ['src/app/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}', 'src/app/dev/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@shared/api',
              message: 'In the app shell import from the module itself (e.g. @shared/api/client). The barrel pulls every API function into the start bundle and makes the bundler split it into a second start request.',
            },
          ],
          patterns: [{ group: ['@mock/*', '**/mock/**'], message: 'The mock API must never be imported by app code (tests excepted).' }],
        },
      ],
    },
  },
  {
    files: ['src/app/dev/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['@mock/*', '**/mock/**'], message: 'The mock API must never be imported by app code (tests excepted).' }] }],
    },
  },
  {
    // Shared code is used by every feature, so it may not depend on one.
    // (src/app is the one place that knows the features: it lazy-loads them.)
    files: ['src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/features/**', '**/features'], message: 'Shared code must not import a feature. Move what is needed into src/shared.' },
            { group: ['**/app/**', '@app/*'], message: 'Shared code must not import the app shell.' },
          ],
        },
      ],
    },
  },
  {
    // Shared, non-test code: both restrictions at once (a later block replaces an earlier one for the same rule).
    files: ['src/shared/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}', 'src/shared/test/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@mock/*', '**/mock/**'], message: 'The mock API must never be imported by app code (tests excepted).' },
            { group: ['**/features/**', '**/features'], message: 'Shared code must not import a feature. Move what is needed into src/shared.' },
            { group: ['**/app/**', '@app/*'], message: 'Shared code must not import the app shell.' },
          ],
        },
      ],
    },
  },
  ...['learner', 'lessons', 'admin', 'games'].map((feature) => ({
    files: [`src/features/${feature}/**/*.{ts,tsx}`],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: boundaries(feature),
  })),
  {
    files: ['*.{js,ts}', 'build/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
);
