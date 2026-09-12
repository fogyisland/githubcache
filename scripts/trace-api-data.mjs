// Trace /api/v1/repos behavior for 50 existing + 20 nonexistent repos.
// For each repo, captures:
//   - HTTP status, fetch_status, etag presence
//   - rate-limit headers remaining/reset
//   - DB row state (flat columns + metadata summary)
//   - whether scheduler picked up the job (refresh_jobs row)
// Goal: show what data the local cache actually stores vs what GitHub returns.
import { setTimeout as wait } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';

const BASE = process.env.BASE ?? 'http://localhost:5002';
const KEY = process.env.API_KEY ?? 'ghc_live_ddd66d854f590db9633325996a3f2017';
const COOKIE = 'ghc_setup_done=1';

// 50 well-known repos that should exist. Split into two groups:
//   - CACHED (42): already in the DB from prior runs — API returns 200/ok, no DB write
//   - FRESH  (8): never queried in this DB — API returns 202/pending, scheduler
//                 fetches and runs storeRepoMetadata, which is what we want to
//                 verify populates the flat columns after the M27.4 fix.
const CACHED = [
  'facebook/react', 'vuejs/vue', 'angular/angular', 'sveltejs/svelte',
  'microsoft/TypeScript', 'microsoft/vscode', 'nodejs/node', 'denoland/deno',
  'oven-sh/bun', 'rust-lang/rust', 'tokio-rs/tokio', 'gfx-rs/wgpu',
  'python/cpython', 'django/django', 'pallets/flask', 'fastapi/fastapi',
  'pandas-dev/pandas', 'numpy/numpy', 'pytorch/pytorch', 'tensorflow/tensorflow',
  'golang/go', 'gin-gonic/gin', 'labstack/echo', 'kubernetes/kubernetes',
  'docker/compose', 'moby/moby', 'hashicorp/terraform', 'hashicorp/vault',
  'elastic/elasticsearch', 'grafana/grafana', 'prometheus/prometheus',
  'apple/swift', 'JetBrains/kotlin', 'neovim/neovim', 'redis/redis',
  'memcached/memcached', 'apache/kafka', 'rabbitmq/rabbitmq-server',
  'mongodb/mongo', 'romkatv/powerlevel10k', 'ohmyzsh/ohmyzsh',
];
const FRESH = [
  'tldr-pages/tldr', 'vercel/next.js', 'vitejs/vite', 'tailwindlabs/tailwindcss',
  'shadcn-ui/ui', 'ant-design/ant-design', 'mui/material-ui',
  'prisma/prisma', 'supabase/supabase', 'withastro/astro',
];
const EXISTING = [...CACHED, ...FRESH];

// 20 nonexistent (made-up owner/name combos). All 404 expected.
const MISSING = [
  'apple/foundation-models',          // doesn't exist (Apple never released a public repo with this name)
  'cncf/cloud-native-devops',         // not a real repo
  'sorin/bond',                       // wrong org (bond is a shell plugin framework, not a GitHub repo)
  'keydb/keydb',                      // real repo is snap-stanford/KeyDB (case-sensitive path)
  'vector/undefined',                 // would need owner/name split fix — should 404 cleanly
  'no-org-xyzzy-9999/does-not-exist',
  'definitely-not-a-real-org/repo',
  'foo/bar-baz-quux-12345',
  'asdfqwer/zxcv',
  'totally-fake-org-12345/anything',
  'placeholder-org/repo-with-no-content',
  'org-that-doesnt-exist/repo',
  'missing-org/missing-repo',
  'fakeuser999/repo',
  'zxcvbnm/asdfgh',
  'qwerty/ytrewq',
  'lkjhgf/poiuyt',
  'mnbvcxz/lkjhgfdsa',
  'aaaaaa/bbbbbb',
  'cccccc/ddddddd',
];

// Sanity
const seen = new Set();
const existingUnique = EXISTING.filter((r) => {
  if (seen.has(r)) return false;
  seen.add(r);
  return true;
});
const missingUnique = MISSING.filter((r) => {
  if (seen.has(r)) return false;
  seen.add(r);
  return true;
});

console.log(`#existing: ${existingUnique.length}, #missing: ${missingUnique.length}`);

const prisma = new PrismaClient();

async function probeOne(owner, name, kind) {
  const url = `${BASE}/api/v1/repos/${owner}/${name}`;
  const t0 = Date.now();
  const res = await fetch(url, {
    headers: { 'x-api-key': KEY, cookie: COOKIE, accept: 'application/json' },
  });
  const body = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(body); } catch {}
  return {
    kind,
    repo: `${owner}/${name}`,
    status: res.status,
    fetchStatus: parsed?.fetch_status ?? null,
    found: parsed?.found ?? null,
    bytes: body.length,
    rateRemaining: res.headers.get('x-ratelimit-remaining'),
    rateReset: res.headers.get('x-ratelimit-reset'),
    latencyMs: Date.now() - t0,
    // Sample one row from the parsed body (don't dump the whole thing for 70 repos)
    sampleFields: parsed?.metadata ? {
      stars: parsed.metadata.stars,
      forks: parsed.metadata.forks,
      watchers: parsed.metadata.watchers,
      language: parsed.metadata.language,
      license: parsed.metadata.license,
      archived: parsed.metadata.archived,
      private: parsed.metadata.private,
      topics_count: Array.isArray(parsed.metadata.topics) ? parsed.metadata.topics.length : 0,
      branches_count: Array.isArray(parsed.metadata.branches) ? parsed.metadata.branches.length : 0,
      releases_count: Array.isArray(parsed.metadata.recentReleases) ? parsed.metadata.recentReleases.length : 0,
      has_payload: parsed.payload !== undefined,
    } : null,
  };
}

async function dbState(owner, name) {
  const row = await prisma.repository.findUnique({
    where: { owner_name: { owner, name } },
    select: {
      id: true,
      fetchStatus: true,
      stars: true,
      forks: true,
      watchers: true,
      description: true,
      language: true,
      license: true,
      archived: true,
      private: true,
      topics: true,
      repoCreatedAt: true,
      repoUpdatedAt: true,
      lastFetchedAt: true,
      fetchError: true,
      metadata: true,
    },
  });
  if (!row) return null;
  const ser = (_, v) => (typeof v === 'bigint' ? v.toString() : v);
  // Don't dump the full metadata — just summary
  const md = row.metadata ?? {};
  return {
    id: row.id.toString(),
    fetch_status: row.fetchStatus,
    flat: {
      stars: row.stars,
      forks: row.forks,
      watchers: row.watchers,
      description: row.description,
      language: row.language,
      license: row.license,
      archived: Boolean(row.archived),
      private: Boolean(row.private),
      topics_count: Array.isArray(row.topics) ? row.topics.length : 0,
      repo_created_at: row.repoCreatedAt?.toISOString() ?? null,
      repo_updated_at: row.repoUpdatedAt?.toISOString() ?? null,
    },
    metadata_summary: {
      has_stars: typeof md.stars === 'number',
      has_forks: typeof md.forks === 'number',
      has_watchers: typeof md.watchers === 'number',
      branches: Array.isArray(md.branches) ? md.branches.length : 0,
      releases: Array.isArray(md.recentReleases) ? md.recentReleases.length : 0,
    },
    last_fetched_at: row.lastFetchedAt?.toISOString() ?? null,
    fetch_error: row.fetchError,
  };
}

async function main() {
  console.log(`\n=== Phase 1: probe all 70 endpoints ===`);
  const probes = [];
  for (let i = 0; i < existingUnique.length; i += 10) {
    const batch = existingUnique.slice(i, i + 10).map((r) => probeOne(...r.split('/'), 'existing'));
    const r = await Promise.all(batch);
    probes.push(...r);
    console.log(`  existing batch ${Math.floor(i / 10) + 1}: ${r.map((x) => x.status + '/' + x.fetchStatus).join(', ')}`);
    await wait(50);
  }
  for (let i = 0; i < missingUnique.length; i += 10) {
    const batch = missingUnique.slice(i, i + 10).map((r) => probeOne(...r.split('/'), 'missing'));
    const r = await Promise.all(batch);
    probes.push(...r);
    console.log(`  missing  batch ${Math.floor(i / 10) + 1}: ${r.map((x) => x.status + '/' + x.fetchStatus).join(', ')}`);
    await wait(50);
  }

  // Tally
  const byKind = {};
  for (const p of probes) {
    byKind[p.kind] ??= { status: {}, fetchStatus: {} };
    byKind[p.kind].status[p.status] = (byKind[p.kind].status[p.status] ?? 0) + 1;
    if (p.fetchStatus) byKind[p.kind].fetchStatus[p.fetchStatus] = (byKind[p.kind].fetchStatus[p.fetchStatus] ?? 0) + 1;
  }
  console.log('\n=== Phase 1 results ===');
  console.log(JSON.stringify(byKind, null, 2));

  // Pick a sample of probes to inspect deeper — 3 cached + 3 fresh + 2 missing
  const sample = [
    ...probes.filter((p) => p.kind === 'existing' && CACHED.includes(p.repo)).slice(0, 3),
    ...probes.filter((p) => p.kind === 'existing' && FRESH.includes(p.repo)).slice(0, 3),
    ...probes.filter((p) => p.kind === 'missing').slice(0, 2),
  ];
  console.log('\n=== Sample probes (full API shape) ===');
  for (const p of sample) {
    console.log(`\n--- ${p.kind}: ${p.repo} (HTTP ${p.status}, fetch=${p.fetchStatus}) ---`);
    console.log('rate-remaining:', p.rateRemaining, 'rate-reset:', p.rateReset, 'bytes:', p.bytes, 'latency:', p.latencyMs, 'ms');
    if (p.sampleFields) {
      console.log('parsed body sample fields:', JSON.stringify(p.sampleFields, null, 2));
    } else {
      console.log('(no metadata in parsed body)');
    }
  }

  // Wait for scheduler to drain any new pending jobs (60s tick, plus margin)
  console.log('\n=== Phase 2: wait 90s for scheduler to drain pending refresh jobs ===');
  for (let sec = 0; sec < 90; sec += 15) {
    await wait(15_000);
    const [pending, done, total] = await Promise.all([
      prisma.refreshJob.count({ where: { status: 'pending' } }),
      prisma.refreshJob.count({ where: { status: 'done' } }),
      prisma.refreshJob.count(),
    ]);
    console.log(`  [+${sec + 15}s] jobs=${total} pending=${pending} done=${done}`);
  }

  // DB state — pick 3 cached + 5 fresh + 3 missing
  console.log('\n=== Phase 3: DB row state for selected repos ===');
  const dbSamples = [
    ...probes.filter((p) => p.kind === 'existing' && CACHED.includes(p.repo)).slice(0, 3),
    ...probes.filter((p) => p.kind === 'existing' && FRESH.includes(p.repo)).slice(0, 5),
    ...probes.filter((p) => p.kind === 'missing').slice(0, 3),
  ];
  for (const p of dbSamples) {
    const [owner, name] = p.repo.split('/');
    const state = await dbState(owner, name);
    console.log(`\n--- ${p.kind}: ${p.repo} ---`);
    console.log(JSON.stringify(state, null, 2));
  }

  // Aggregate: how many FRESH repos (the ones that hit storeRepoMetadata
  // after the M27.4 fix) now have populated flat columns vs CACHED ones
  // (written before the fix, still showing 0)?
  console.log('\n=== Phase 4: flat-column coverage — fresh vs cached ===');
  const rows = await prisma.repository.findMany({
    where: { OR: existingUnique.map((r) => {
      const [o, n] = r.split('/');
      return { owner: o, name: n };
    }) },
    select: { owner: true, name: true, stars: true, forks: true, watchers: true, description: true, language: true, topics: true },
  });
  const freshSet = rows.filter((r) => FRESH.includes(`${r.owner}/${r.name}`));
  const cachedSet = rows.filter((r) => CACHED.includes(`${r.owner}/${r.name}`));
  const tally = (rs, label) => {
    const total = rs.length;
    const withStars = rs.filter((r) => r.stars > 0).length;
    const withForks = rs.filter((r) => r.forks > 0).length;
    const withWatchers = rs.filter((r) => r.watchers > 0).length;
    const withDesc = rs.filter((r) => r.description !== null && r.description !== '').length;
    const withLang = rs.filter((r) => r.language !== null && r.language !== '').length;
    const withTopics = rs.filter((r) => Array.isArray(r.topics) && r.topics.length > 0).length;
    console.log(`\n  [${label}] rows=${total}`);
    console.log(`    stars>0     : ${withStars}`);
    console.log(`    forks>0     : ${withForks}`);
    console.log(`    watchers>0  : ${withWatchers}`);
    console.log(`    desc!=null  : ${withDesc}`);
    console.log(`    language!=null: ${withLang}`);
    console.log(`    topics>=1   : ${withTopics}`);
  };
  tally(freshSet, 'FRESH (written after fix)');
  tally(cachedSet, 'CACHED (written before fix)');

  await prisma.$disconnect();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });