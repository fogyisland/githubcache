import next from 'eslint-config-next';

const config = [
  ...(Array.isArray(next) ? next : (next.default ?? [next])),
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'dist/**',
      'coverage/**',
      '.superpowers/**',
      'next-env.d.ts',
    ],
  },
];

export default config;
