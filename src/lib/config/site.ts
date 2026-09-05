// M24 — single source of truth for the site brand name.
//
// Read from `SITE_NAME` env var (set by `npm run init`), with a default
// fallback. Pages that show the brand in chrome (header, footer, <title>)
// import `SITE_NAME` from here instead of hardcoding the literal.
//
// Note: i18n translations still contain "GitHub Metadata Cache" in title
// templates like "{owner}/{name} · GitHub Metadata Cache" — those are
// rendered through next-intl so the brand name there is fixed per locale.
// To customize the brand across translations, search-and-replace the
// literal in messages/en.json + messages/zh.json after running `init`.

export const SITE_NAME: string =
  process.env['SITE_NAME'] && process.env['SITE_NAME']!.length > 0
    ? process.env['SITE_NAME']!
    : 'GitHub Metadata Cache';
