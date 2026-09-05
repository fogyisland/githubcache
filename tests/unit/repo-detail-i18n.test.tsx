import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, Fragment } from 'react';

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

const repoMetaDict = flattenDict({
  title: '{owner}/{name} · GitHub Metadata Cache',
  description: 'Cached metadata for the GitHub repository {owner}/{name}.',
});

const repoHeroDict = flattenDict({
  masthead: 'repository · cached metadata',
  backToAll: '← All repositories',
  viewOnGithub: 'View on GitHub',
  chipArchived: 'Archived',
  chipDisabled: 'Disabled',
});

const repoStatsDict = flattenDict({
  stars: 'Stars',
  forks: 'Forks',
  watchers: 'Watchers',
});

const repoRepositoryCardDict = flattenDict({
  heading: 'Repository',
  defaultBranch: 'Default branch',
  githubUrl: 'GitHub URL',
  homepage: 'Homepage',
  path: 'Path',
  dash: '–',
});

const repoActivityCardDict = flattenDict({
  heading: 'Activity',
  created: 'Created',
  updated: 'Updated',
  lastPush: 'Last push',
});

const repoFooterDict = flattenDict({
  lastFetched: 'Last fetched:',
  dash: '–',
  backToHome: '← back to home',
});

const repoDict = flattenDict({
  meta: repoMetaDict,
  hero: repoHeroDict,
  stats: repoStatsDict,
  repositoryCard: repoRepositoryCardDict,
  activityCard: repoActivityCardDict,
  footer: repoFooterDict,
  apiShape: {
    eyebrow: 'Raw API shape',
    hint: 'GET {path} → see {link} for full schema',
  },
  notFound: {
    title: 'Repository not found',
    description: "That repo doesn't exist on GitHub (or is private and not accessible).",
    backToHome: '← Back to home',
  },
});

const serverDicts: Record<string, Record<string, string>> = {
  'repo.meta': repoMetaDict,
  'repo.hero': repoHeroDict,
  'repo.stats': repoStatsDict,
  'repo.repositoryCard': repoRepositoryCardDict,
  'repo.activityCard': repoActivityCardDict,
  'repo.footer': repoFooterDict,
  'repo': repoDict,
  'repo.apiShape': {
    eyebrow: 'Raw API shape',
    hint: 'GET {path} → see {link} for full schema',
  },
  'repo.notFound': {
    title: 'Repository not found',
    description: "That repo doesn't exist on GitHub (or is private and not accessible).",
    backToHome: '← Back to home',
  },
};

type TransFn = {
  (key: string, vars?: Record<string, string | number>): string;
  rich: (key: string, chunks: Record<string, () => React.ReactElement>) => React.ReactNode;
};

vi.mock('next-intl/server', () => ({
  getTranslations: async (ns: string) => {
    const dict = serverDicts[ns] ?? {};
    const t = ((key: string, vars?: Record<string, string | number>) => {
      const v = dict[key];
      if (v && vars) {
        return v.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));
      }
      return v ?? key;
    }) as TransFn;
    t.rich = (key: string, chunks: Record<string, () => React.ReactElement>) => {
      const v = dict[key];
      if (!v) return key;
      // Tokenize around {chunkName} placeholders and render React elements
      const parts = v.split(/\{(\w+)\}/);
      const out: React.ReactNode[] = [];
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part === undefined) continue;
        if (i % 2 === 0) {
          out.push(part);
        } else {
          const fn = chunks[part];
          if (fn) out.push(fn());
        }
      }
      return createElement(Fragment, null, ...out);
    };
    return t;
  },
}));

// Mock lookupRepo with controllable behavior
const mockOkResult = {
  fetch_status: 'ok' as const,
  canonical: 'facebook/react',
  metadata: {
    full_name: 'facebook/react',
    stargazers_count: 200000,
    forks_count: 40000,
    subscribers_count: 6000,
    language: 'JavaScript',
    default_branch: 'main',
    homepage: 'https://reactjs.org',
    html_url: 'https://github.com/facebook/react',
    description: 'A declarative, efficient, and flexible JavaScript library for building user interfaces.',
    topics: ['react', 'frontend'],
    license: { spdx_id: 'MIT' },
    created_at: '2013-05-24T16:15:54Z',
    updated_at: '2024-01-01T00:00:00Z',
    pushed_at: '2024-01-01T00:00:00Z',
    archived: true,
    disabled: true,
  },
  last_fetched_at: new Date('2024-06-01T12:34:56Z'),
  stale: false,
};

const mockErrorResult = {
  fetch_status: 'error' as const,
  canonical: 'facebook/react',
  error: 'GitHub returned a 500 error',
};

let mockLookupResult: unknown = mockOkResult;

vi.mock('@/lib/cache/lookup', () => ({
  lookupRepo: async () => mockLookupResult,
  QueryResult: {},
}));

vi.mock('@/lib/repo/metadata', () => ({
  formatCount: (n: number) => String(n),
  formatDate: (_d: unknown) => '2024-01-01',
  getArchived: (m: { archived?: boolean }) => m.archived ?? false,
  getCreatedAt: (m: { created_at?: string }) => m.created_at,
  getDefaultBranch: (m: { default_branch?: string }) => m.default_branch,
  getDescription: (m: { description?: string }) => m.description,
  getDisabled: (m: { disabled?: boolean }) => m.disabled ?? false,
  getForks: (m: { forks_count?: number }) => m.forks_count ?? 0,
  getHomepage: (m: { homepage?: string }) => m.homepage,
  getHtmlUrl: (_o: string, n: string) => `https://github.com/facebook/${n}`,
  getLanguage: (m: { language?: string }) => m.language,
  getLicenseName: (m: { license?: { spdx_id?: string } }) => m.license?.spdx_id,
  getPushedAt: (m: { pushed_at?: string }) => m.pushed_at,
  getStars: (m: { stargazers_count?: number }) => m.stargazers_count ?? 0,
  getTopics: (m: { topics?: string[] }) => m.topics ?? [],
  getUpdatedAt: (m: { updated_at?: string }) => m.updated_at,
  getWatchers: (m: { subscribers_count?: number }) => m.subscribers_count ?? 0,
}));

// Stub ApiShape as a sync element — the page uses it as a child component,
// and rendering a Promise in JSX is not supported by react-dom/server.
// Its translation assertions live in the sub-component test below.
vi.mock('@/app/repo/[owner]/[name]/_components/api-shape', () => ({
  ApiShape: () => createElement('div', { 'data-testid': 'api-shape-stub' }),
}));

// M24 — same stub treatment for the new fetch-history + recent-queries
// sections. They call resolveRequestTimezone → cookies(), which throws
// in the vitest render path (no request scope).
vi.mock('@/app/repo/[owner]/[name]/_components/fetch-history', () => ({
  FetchHistory: () => createElement('div', { 'data-testid': 'fetch-history-stub' }),
}));
vi.mock('@/app/repo/[owner]/[name]/_components/recent-queries', () => ({
  RecentQueries: () => createElement('div', { 'data-testid': 'recent-queries-stub' }),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

import RepoDetailPage, { generateMetadata } from '@/app/repo/[owner]/[name]/page';
import RepoNotFound from '@/app/repo/[owner]/[name]/not-found';

describe('generateMetadata i18n', () => {
  it('returns interpolated title and description for owner/name', async () => {
    const meta = await generateMetadata({
      params: { owner: 'facebook', name: 'react' },
    });
    expect(meta.title).toBe('facebook/react · GitHub Metadata Cache');
    expect(meta.description).toBe(
      'Cached metadata for the GitHub repository facebook/react.',
    );
  });
});

describe('RepoDetailPage (ok branch) i18n', () => {
  it('renders translated hero, stats, cards, footer for a successful lookup', async () => {
    mockLookupResult = mockOkResult;
    const el = await RepoDetailPage({ params: { owner: 'facebook', name: 'react' } });
    const html = renderToStaticMarkup(el);
    // hero
    expect(html).toContain('repository · cached metadata');
    expect(html).toContain('← All repositories');
    expect(html).toContain('View on GitHub');
    // archived + disabled chips
    expect(html).toContain('Archived');
    expect(html).toContain('Disabled');
    // stats
    expect(html).toContain('>Stars<');
    expect(html).toContain('>Forks<');
    expect(html).toContain('>Watchers<');
    // repository card
    expect(html).toContain('>Repository<');
    expect(html).toContain('Default branch');
    expect(html).toContain('GitHub URL');
    expect(html).toContain('Path');
    // activity card
    expect(html).toContain('>Activity<');
    expect(html).toContain('Created');
    expect(html).toContain('Updated');
    expect(html).toContain('Last push');
    // footer
    expect(html).toContain('Last fetched:');
    expect(html).toContain('← back to home');
  });
});

describe('RepoDetailPage (error branch) i18n', () => {
  it('renders translated back-link for error result (data is untranslated)', async () => {
    mockLookupResult = mockErrorResult;
    const el = await RepoDetailPage({ params: { owner: 'facebook', name: 'react' } });
    const html = renderToStaticMarkup(el);
    expect(html).toContain('← All repositories');
    // raw error from lookupRepo — must NOT be translated
    expect(html).toContain('GitHub returned a 500 error');
  });
});

describe('RepoNotFound i18n', () => {
  it('renders translated title, description, and back-to-home', async () => {
    const el = await RepoNotFound();
    const html = renderToStaticMarkup(el);
    expect(html).toContain('Repository not found');
    // the apostrophe in "doesn't" becomes HTML-encoded as &#x27; by react-dom
    expect(html).toContain('That repo doesn');
    expect(html).toContain('GitHub');
    expect(html).toContain('← Back to home');
  });
});

describe('ApiShape i18n (sub-component)', () => {
  it('renders translated eyebrow and rich hint with path + link React elements', async () => {
    mockLookupResult = mockOkResult;
    const mod = await vi.importActual<
      typeof import('@/app/repo/[owner]/[name]/_components/api-shape')
    >('@/app/repo/[owner]/[name]/_components/api-shape');
    const el = await mod.ApiShape({ owner: 'facebook', name: 'react', metadata: { foo: 'bar' } });
    const html = renderToStaticMarkup(el);
    expect(html).toContain('Raw API shape');
    // rich hint should render both the api path and the docs link
    expect(html).toContain('/api/v1/repos/facebook/react');
    expect(html).toContain('/docs/api/v1-repos');
  });
});
