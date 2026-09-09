import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // serverActions are not used in M0; reserved for later
  },
  // M28.bug20 — silence webpack's FileSystemInfo warnings about next-intl's
  // production extractor (`import(t(c).href)` — a dynamic import inside a
  // helper that webpack can't statically trace at build time). The warning
  // is harmless (build succeeds, cache is just slightly less precise), but
  // it prints on every `npm run build` / `next build`. `dynamicImportMode:
  // 'weak'` alone isn't enough — FileSystemInfo emits the warning
  // independently — so we also tell webpack's stats to ignore it.
  webpack: (config, { webpack }) => {
    if (!config.module.parser) config.module.parser = {};
    if (!config.module.parser.javascript) config.module.parser.javascript = {};
    config.module.parser.javascript.dynamicImportMode = 'weak';
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      {
        module: /node_modules[\\/]next-intl[\\/]/,
        message: /FileSystemInfo|Parsing of .* for build dependencies failed/,
      },
    ];
    return config;
  },
};

export default withNextIntl(nextConfig);
