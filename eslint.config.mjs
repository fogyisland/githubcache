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
      // .next/ also ships inside release/ — exclude both roots.
      'release/**/.next/**',
      'node_modules/**',
      'dist/**',
      'release/**',
      'coverage/**',
      '.superpowers/**',
      'next-env.d.ts',
    ],
  },
];

export default config;
