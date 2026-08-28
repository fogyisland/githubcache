import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

function flattenDict(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix === '' ? k : `${prefix}.${k}`;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenDict(v as Record<string, unknown>, path));
    } else {
      out[path] = String(v);
    }
  }
  return out;
}

const homeDict = flattenDict({
  hero: {
    eyebrow: 'Managed cache · per-IP rate-limited · open API',
    title: 'GitHub Metadata Cache',
    tagline: 'Submit an owner / repository, get fresh metadata in milliseconds. Backed by a managed cache — no GitHub rate-limit pressure on your side.',
  },
  recent: {
    heading: 'Recent lookups',
    countCached: '{count} cached',
    empty: 'No repositories cached yet. Try submitting a repo above.',
    starsPrefix: '★ ',
  },
});

const metaDict = flattenDict({
  title: 'GitHub Metadata Cache',
  description: 'Look up GitHub repository metadata — stars, forks, language, and more — instantly from a managed cache.',
});

const featuresDict = flattenDict({
  eyebrow: 'What you get',
  heading: 'A cache that takes the load off GitHub.',
  items: {
    instant: {
      title: 'Instant',
      demo: '~12 ms median',
      body: 'Most lookups come straight from the local DB — no roundtrip to GitHub, no rate-limit waiting.',
    },
    cached: {
      title: 'Cached',
      demo: 'metadata + node tree',
      body: 'Stored as JSON in MySQL — the same payload you would have built from the GitHub REST API.',
    },
    rateLimited: {
      title: 'Rate-limited + API',
      demo: '60 req/min · 10k/day',
      body: 'Per-key quotas protect the cache. A clean REST endpoint mirrors the GitHub shape so existing clients work.',
    },
  },
});

const howItWorksDict = flattenDict({
  eyebrow: 'How it works',
  heading: 'Three steps from request to JSON.',
  steps: {
    submit: {
      title: 'You submit owner/repo',
      body: 'A simple form on the homepage, or a single GET to /api/v1/repos/{owner}/{name} from anywhere.',
    },
    cacheOrFetch: {
      title: 'Cache hit or live fetch',
      body: 'If the row is fresh, you get it back in milliseconds. Otherwise we call GitHub, write to MySQL, and return the same shape.',
    },
    json: {
      title: 'JSON response',
      body: 'The same fields the GitHub REST API returns — id, full_name, stargazers_count, language, default_branch, plus a recursive tree node.',
    },
  },
});

const timeAgoDict = flattenDict({
  justNow: 'just now',
  minutesAgo: '{m}m ago',
  hoursAgo: '{h}h ago',
  daysAgo: '{d}d ago',
  dash: '–',
});

const lookupFormDict = flattenDict({
  ariaLabel: 'Look up a GitHub repository',
  ownerLabel: 'Owner',
  ownerPlaceholder: 'e.g. facebook',
  repoLabel: 'Repository',
  repoPlaceholder: 'e.g. react',
});

const statsDict = flattenDict({
  cachedRepositories: 'Cached repositories',
  cachedRepositoriesHint: 'live count',
  healthyRepos: 'Healthy repos',
  healthyReposHint: 'fetch_status = ok',
  activeTokens: 'Active GitHub tokens',
  activeTokensHint: 'in the rotation',
  refreshes: 'Refreshes (24h)',
  refreshesHint: 'completed jobs',
});

const serverDicts: Record<string, Record<string, string>> = {
  'home.meta': metaDict,
  'home': homeDict,
  'home.features': featuresDict,
  'home.howItWorks': howItWorksDict,
  'home.timeAgo': timeAgoDict,
};

const clientDicts: Record<string, Record<string, string>> = {
  'home.lookup.form': lookupFormDict,
  'home.stats': statsDict,
};

vi.mock('next-intl/server', () => ({
  getTranslations: async (ns: string) => {
    return (key: string, vars?: Record<string, string | number>) => {
      const v = serverDicts[ns]?.[key];
      if (v && vars) {
        return v.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));
      }
      return v ?? key;
    };
  },
}));

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => {
    return (key: string, vars?: Record<string, string | number>) => {
      const v = clientDicts[ns]?.[key];
      if (v && vars) return v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
      return v ?? key;
    };
  },
}));

vi.mock('@/lib/db/repositories', () => ({
  recentLookups: async () => [],
}));

// Stub react-dom hooks used by client components
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return {
    ...actual,
    useFormState: (_action: unknown, initial: unknown) => [initial, () => undefined],
    useFormStatus: () => ({ pending: false }),
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/',
}));

// Stub async server components for HomePage render — React 18's
// renderToStaticMarkup cannot resolve Promises returned by async server
// components in JSX, so we substitute the heavy children with stubs and
// verify their translations directly below via vi.importActual.
vi.mock('@/app/_components/lookup-form', () => ({
  LookupForm: () => createElement('div', { 'data-testid': 'lookup-form-stub' }),
}));
vi.mock('@/app/_components/recent-lookups-list', () => ({
  RecentLookupsList: () => createElement('div', { 'data-testid': 'recent-lookups-list-stub' }),
}));
vi.mock('@/app/_components/stats-bar', () => ({
  StatsBar: () => createElement('div', { 'data-testid': 'stats-bar-stub' }),
}));
vi.mock('@/app/_components/features-section', () => ({
  FeaturesSection: () => createElement('div', { 'data-testid': 'features-section-stub' }),
}));
vi.mock('@/app/_components/how-it-works', () => ({
  HowItWorks: () => createElement('div', { 'data-testid': 'how-it-works-stub' }),
}));
vi.mock('@/app/_components/quick-try', () => ({
  QuickTry: () => createElement('div', { 'data-testid': 'quick-try-stub' }),
}));
vi.mock('@/app/_components/site-footer', () => ({
  SiteFooter: async () =>
    createElement('div', { 'data-testid': 'site-footer-stub' }, 'footer'),
}));

vi.mock('../../../package.json', () => ({
  default: { version: '0.0.0-test' },
}));

import HomePage, { generateMetadata } from '@/app/page';

describe('HomePage i18n smoke (page-level chrome)', () => {
  it('renders translated hero title and eyebrow', async () => {
    const el = await HomePage();
    const html = renderToStaticMarkup(el);
    expect(html).toContain('GitHub Metadata Cache');
    expect(html).toContain('Managed cache · per-IP rate-limited · open API');
  });

  it('renders translated recent section heading and interpolated cached count', async () => {
    const el = await HomePage();
    const html = renderToStaticMarkup(el);
    expect(html).toContain('>Recent lookups<');
    expect(html).toContain('0 cached');
  });
});

describe('generateMetadata i18n', () => {
  it('returns translated title and description', async () => {
    const meta = await generateMetadata();
    expect(meta.title).toBe('GitHub Metadata Cache');
    expect(meta.description).toBe(
      'Look up GitHub repository metadata — stars, forks, language, and more — instantly from a managed cache.',
    );
  });
});

// Sub-component translations: bypass the module-level stubs by re-importing
// the actual modules with vi.importActual. React 18's renderToStaticMarkup
// handles an already-resolved ReactElement (the result of awaiting the async
// server component) without trying to unwrap a Promise in JSX.
describe('FeaturesSection i18n (sub-component)', () => {
  it('renders translated heading and instant item title', async () => {
    const mod = await vi.importActual<typeof import('@/app/_components/features-section')>(
      '@/app/_components/features-section',
    );
    const el = await mod.FeaturesSection();
    const html = renderToStaticMarkup(el);
    expect(html).toContain('A cache that takes the load off GitHub.');
    expect(html).toContain('>Instant<');
  });
});

describe('HowItWorks i18n (sub-component)', () => {
  it('renders translated heading', async () => {
    const mod = await vi.importActual<typeof import('@/app/_components/how-it-works')>(
      '@/app/_components/how-it-works',
    );
    const el = await mod.HowItWorks();
    const html = renderToStaticMarkup(el);
    expect(html).toContain('Three steps from request to JSON.');
  });
});

describe('RecentLookupsList i18n (sub-component, empty state)', () => {
  it('renders translated empty-state message when repos is empty', async () => {
    const mod = await vi.importActual<typeof import('@/app/_components/recent-lookups-list')>(
      '@/app/_components/recent-lookups-list',
    );
    const el = await mod.RecentLookupsList({ repos: [] });
    const html = renderToStaticMarkup(el);
    expect(html).toContain('No repositories cached yet. Try submitting a repo above.');
  });
});
