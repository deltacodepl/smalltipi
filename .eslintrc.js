module.exports = {
  plugins: ['@typescript-eslint', 'import', 'react', 'jest', 'jsdoc', 'jsx-a11y', 'testing-library', 'jest-dom'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'next/core-web-vitals',
    'next',
    'airbnb',
    'airbnb-typescript',
    'eslint:recommended',
    'plugin:import/typescript',
    'prettier',
    'plugin:react/recommended',
    'plugin:jsdoc/recommended',
    'plugin:jsx-a11y/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  rules: {
    'no-restricted-exports': 0,
    'no-redeclare': 0, // already handled by @typescript-eslint/no-redeclare
    'react/display-name': 0,
    'react/prop-types': 0,
    'react/function-component-definition': 0,
    'react/require-default-props': 0,
    'import/prefer-default-export': 0,
    'react/jsx-props-no-spreading': 0,
    'react/no-unused-prop-types': 0,
    'react/button-has-type': 0,
    'import/no-extraneous-dependencies': [
      'error',
      { devDependencies: ['esbuild.js', 'e2e/**', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/*.factory.{ts,tsx}', '**/mocks/**', 'tests/**', '**/*.d.ts'] },
    ],
    'no-underscore-dangle': 0,
    'arrow-body-style': 0,
    'class-methods-use-this': 0,
    'jsdoc/require-returns': 0,
  },
  overrides: [
    {
      files: ['src/**/__tests__/**/*.[jt]s?(x)', 'src/**/?(*.)+(spec|test).[jt]s?(x)'],
      extends: ['plugin:testing-library/react', 'plugin:jest-dom/recommended'],
    },
  ],
  globals: {
    JSX: true,
    NodeJS: true,
  },
  env: {
    'jest/globals': true,
  },
};
