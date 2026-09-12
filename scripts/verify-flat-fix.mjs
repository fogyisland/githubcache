// Verify the M27.4 flat-column fix by probing 5 truly-fresh repos
// (none in DB), waiting for the scheduler to fetch + store them, then
// reading back the DB row to confirm flat columns are populated.
import { setTimeout as wait } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';

const BASE = process.env.BASE ?? 'http://localhost:5002';
const KEY = process.env.API_KEY ?? 'ghc_live_ddd66d854f590db9633325996a3f2017';
const COOKIE = 'ghc_setup_done=1';

const FRESH = [
  'babel/babel', 'webpack/webpack', 'rollup/rollup',
  'parcel-bundler/parcel', 'biomejs/biome',
];
const CACHED = ['facebook/react'];  // control — already in DB from earlier
const MISSING = ['no-such-org-99999/never-existed-repo'];  // control — 404

const prisma = new PrismaClient();
const ser = (_, v) => (typeof v === 'bigint' ? v.toString() : v);

async function probe(owner, name) {
  const url = `${BASE}/api/v1/repos/${owner}/${name}`;
  const r = await fetch(url, {
    headers: { 'x-api-key': KEY, cookie: COOKIE, accept: 'application/json' },
  });
  const body = await r.text();
  let parsed = null;
  try { parsed = JSON.parse(body); } catch {}
  return { status: r.status, fetchStatus: parsed?.fetch_status, bytes: body.length };
}

async function rowState(owner, name) {
  const r = await prisma.repository.findUnique({
    where: { owner_name: { owner, name } },
    select: {
      id: true,
      stars: true,
      forks: true,
      watchers: true,
      description: true,
      language: true,
      license: true,
      topics: true,
      archived: true,
      private: true,
      repoCreatedAt: true,
      repoUpdatedAt: true,
      repoPushedAt: true,
      lastFetchedAt: true,
      metadata: true,
    },
  });
  if (!r) return null;
  const md = r.metadata ?? {};
  return {
    id: r.id.toString(),
    flat: {
      stars: r.stars,
      forks: r.forks,
      watchers: r.watchers,
      description: r.description,
      language: r.language,
      license: r.license,
      topics: Array.isArray(r.topics) ? r.topics : [],
      archived: Boolean(r.archived),
      private: Boolean(r.private),
      repo_created_at: r.repoCreatedAt?.toISOString() ?? null,
      repo_updated_at: r.repoUpdatedAt?.toISOString() ?? null,
      repo_pushed_at: r.repoPushedAt?.toISOString() ?? null,
    },
    metadata_summary: {
      md_stars: md.stars,
      md_forks: md.forks,
      md_watchers: md.watchers,
      md_branches: Array.isArray(md.branches) ? md.branches.length : 0,
      md_releases: Array.isArray(md.recentReleases) ? md.recentReleases.length : 0,
    },
    last_fetched_at: r.lastFetchedAt?.toISOString() ?? null,
  };
}

async function main() {
  console.log('=== probe fresh repos (expect 202/pending) ===');
  const freshProbes = [];
  for (const r of FRESH) {
    const [o, n] = r.split('/');
    const p = await probe(o, n);
    console.log(`  ${r.padEnd(30)} ${p.status}/${p.fetchStatus} (${p.bytes}b)`);
    freshProbes.push({ repo: r, ...p });
  }
  console.log('\n=== probe cached control (expect 200/ok) ===');
  for (const r of CACHED) {
    const [o, n] = r.split('/');
    const p = await probe(o, n);
    console.log(`  ${r.padEnd(30)} ${p.status}/${p.fetchStatus} (${p.bytes}b)`);
  }
  console.log('\n=== probe missing control (expect 404/not_found) ===');
  for (const r of MISSING) {
    const [o, n] = r.split('/');
    const p = await probe(o, n);
    console.log(`  ${r.padEnd(30)} ${p.status}/${p.fetchStatus} (${p.bytes}b)`);
  }

  // Wait 90s for scheduler to drain pending refresh jobs
  console.log('\n=== waiting 90s for scheduler ===');
  for (let s = 15; s <= 90; s += 15) {
    await wait(15_000);
    const [pending, done] = await Promise.all([
      prisma.refreshJob.count({ where: { status: 'pending' } }),
      prisma.refreshJob.count({ where: { status: 'done' } }),
    ]);
    console.log(`  [+${s}s] pending=${pending} done=${done}`);
  }

  console.log('\n=== DB state for fresh repos (the actual fix verification) ===');
  for (const r of FRESH) {
    const [o, n] = r.split('/');
    const s = await rowState(o, n);
    console.log(`\n--- ${r} ---`);
    console.log(JSON.stringify(s, ser, 2));
  }
  console.log('\n=== DB state for cached control ===');
  for (const r of CACHED) {
    const [o, n] = r.split('/');
    const s = await rowState(o, n);
    console.log(`\n--- ${r} ---`);
    console.log(JSON.stringify(s, ser, 2));
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });