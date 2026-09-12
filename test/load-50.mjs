// Load test: hit /api/v1/repos/[owner]/[name] for 50 well-known GitHub
// repos and verify M31 no-stub semantics — a cache-miss returns 200 +
// fetch_status='pending' WITHOUT creating a repositories row. The row is
// only written once the scheduler fetches real data from GitHub.
//
// Phases:
//   1. Hammer 50 endpoints (5 concurrent). Expect HTTP 200 + pending.
//   2. ASSERT: repositories.count() === 0 immediately after Phase 1
//      (M31 contract: no stub row).
//   3. Poll up to 5 minutes for the scheduler to drain. repositories
//      grows toward 50.
//   4. Re-fetch all 50 endpoints. Expect fetch_status='ok'.
//   5. Final tally + pass/fail exit.
import { setTimeout as wait } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';

const BASE = process.env.BASE ?? 'http://localhost:5002';
const KEY = process.env.API_KEY ?? 'ghc_live_ddd66d854f590db9633325996a3f2017';
const COOKIE = process.env.COOKIE ?? 'ghc_setup_done=1';

// First 50 of scripts/load-100.mjs's REPOS list.
const REPOS = [
  'facebook/react', 'vuejs/vue', 'angular/angular', 'sveltejs/svelte',
  'microsoft/TypeScript', 'microsoft/vscode', 'nodejs/node', 'denoland/deno',
  'oven-sh/bun', 'tc39/ecma262', 'WebAssembly/spec', 'rust-lang/rust',
  'tokio-rs/tokio', 'actix/actix-web', 'gfx-rs/wgpu', 'apache/arrow-rs',
  'python/cpython', 'django/django', 'pallets/flask', 'fastapi/fastapi',
  'tiangolo/fastapi', 'pandas-dev/pandas', 'numpy/numpy', 'scikit-learn/scikit-learn',
  'pytorch/pytorch', 'tensorflow/tensorflow', 'keras-team/keras', 'google/jax',
  'huggingface/transformers', 'mlflow/mlflow', 'kubeflow/kubeflow', 'ray-project/ray',
  'golang/go', 'gin-gonic/gin', 'labstack/echo', 'gofiber/fiber',
  'gohugoio/hugo', 'spf13/cobra', 'kubernetes/kubernetes', 'k3s-io/k3s',
  'docker/compose', 'moby/moby', 'containers/podman', 'hashicorp/terraform',
  'hashicorp/vault', 'hashicorp/consul', 'hashicorp/nomad', 'etcd-io/etcd',
  'elastic/elasticsearch', 'elastic/kibana', 'grafana/grafana', 'prometheus/prometheus',
  'jaegertracing/jaeger',
];

// Sanity: unique (owner, name)
const seen = new Set();
const unique = REPOS.filter((r) => {
  if (seen.has(r)) return false;
  seen.add(r);
  return true;
});
console.log(`#repos in list: ${unique.length}`);

const prisma = new PrismaClient();

// owner strings only — used in the M31 repositories.count() assertions.
const ownersArray = Array.from(new Set(unique.map((r) => r.split('/')[0])));

async function getStats(label) {
  const [repos, reposForOwners, jobsByStatus] = await Promise.all([
    prisma.repository.count(),
    prisma.repository.count({ where: { owner: { in: ownersArray } } }),
    prisma.refreshJob.groupBy({ by: ['status'], _count: true }),
  ]);
  const totalJobs = jobsByStatus.reduce((s, g) => s + g._count, 0);
  console.log(
    `[${label}] repos_total=${repos} repos_for_owners=${reposForOwners} ` +
    `jobs=${totalJobs} (${jobsByStatus.map((g) => g.status + '=' + g._count).join(',')})`,
  );
  return { repos_total: repos, repos_for_owners: reposForOwners, jobsByStatus };
}

async function probeOne(owner, name) {
  const url = `${BASE}/api/v1/repos/${owner}/${name}`;
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      headers: {
        'x-api-key': KEY,
        cookie: COOKIE,
        accept: 'application/json',
      },
    });
    const body = await r.text();
    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      // ignore — body may not be JSON (e.g. 5xx HTML page); leave parsed null
    }
    return {
      repo: `${owner}/${name}`,
      status: r.status,
      fetchStatus: parsed?.fetch_status ?? null,
      found: parsed?.found ?? null,
      ms: Date.now() - t0,
      bytes: body.length,
      rateRemaining: r.headers.get('x-ratelimit-remaining'),
    };
  } catch (err) {
    return { repo: `${owner}/${name}`, status: 0, error: err.message, ms: Date.now() - t0 };
  }
}

function tally(results) {
  const byStatus = {};
  const byFetch = {};
  for (const r of results) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (r.fetchStatus) byFetch[r.fetchStatus] = (byFetch[r.fetchStatus] ?? 0) + 1;
  }
  const totalMs = results.reduce((s, r) => s + (r.ms ?? 0), 0);
  return {
    byStatus,
    byFetch,
    totalMs,
    avgMs: totalMs / results.length,
    maxMs: Math.max(...results.map((r) => r.ms ?? 0)),
  };
}

async function main() {
  await getStats('BEFORE');

  // ---------- Phase 1: hammer 50 endpoints (5 concurrent) ----------
  console.log(`\n=== Phase 1: hammer 50 endpoints (5 concurrent) ===`);
  const concurrency = 5;
  const phase1 = [];
  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((r) => probeOne(...r.split('/'))),
    );
    phase1.push(...batchResults);
    console.log(
      `  batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(unique.length / concurrency)} ` +
      `done — last: ${batchResults.at(-1)?.status}/${batchResults.at(-1)?.fetchStatus}`,
    );
    await wait(100);
  }

  const t1 = tally(phase1);
  console.log('Phase 1 results:', t1);

  const phase1Failures = phase1.filter((r) => r.status !== 200 || r.fetchStatus !== 'pending');
  if (phase1Failures.length > 0) {
    console.warn(`WARN: ${phase1Failures.length} endpoints did not return 200/pending:`);
    for (const r of phase1Failures.slice(0, 10)) {
      console.warn(`  ${r.repo}: status=${r.status} fetch=${r.fetchStatus}`);
    }
  }

  await getStats('AFTER PHASE 1');

  // ---------- M31 contract assertion ----------
  console.log(`\n=== M31 assertion: repositories.count({ owner IN owners }) === 0 ===`);
  const reposAfterPhase1 = await prisma.repository.count({
    where: { owner: { in: ownersArray } },
  });
  if (reposAfterPhase1 !== 0) {
    console.error(
      `FAIL: M31 broken — ${reposAfterPhase1} repositories rows exist for pending jobs ` +
      `(expected 0). Stub rows must not be created on cache-miss.`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log('PASS: repositories.count() === 0 — no stub rows written on cache-miss.');

  // ---------- Phase 2: poll for scheduler drain (up to 5 minutes) ----------
  console.log(`\n=== Phase 2: wait up to 5 min for scheduler drain ===`);
  const maxWaitMs = 5 * 60_000;
  const pollMs = 10_000;
  const t2Start = Date.now();
  let lastCount = 0;
  let drained = false;
  for (let elapsed = 0; elapsed < maxWaitMs; elapsed += pollMs) {
    await wait(pollMs);
    const stats = await getStats(`+${Math.floor((elapsed + pollMs) / 1000)}s`);
    lastCount = stats.repos_for_owners;
    if (lastCount >= unique.length) {
      console.log(`  hit ${unique.length}/${unique.length} — scheduler drained, stopping early`);
      drained = true;
      break;
    }
  }
  if (!drained) {
    console.warn(
      `WARN: scheduler did not fully drain in ${Math.round(maxWaitMs / 1000)}s ` +
      `(last count=${lastCount}/${unique.length})`,
    );
  }

  // ---------- Phase 3: stability re-fetch ----------
  console.log(`\n=== Phase 3: re-fetch all 50 endpoints, expect ok ===`);
  const phase3 = [];
  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((r) => probeOne(...r.split('/'))),
    );
    phase3.push(...batchResults);
    console.log(
      `  batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(unique.length / concurrency)} ` +
      `done — last: ${batchResults.at(-1)?.status}/${batchResults.at(-1)?.fetchStatus}`,
    );
    await wait(50);
  }
  const t3 = tally(phase3);
  console.log('Phase 3 results:', t3);

  await getStats('FINAL');
  await prisma.$disconnect();

  // ---------- Final tally + pass/fail ----------
  console.log('\n=== Summary ===');
  console.log(`Phase 1 (initial fetch)        : ${phase1.length} repos`);
  console.log(`  HTTP statuses: ${JSON.stringify(t1.byStatus)}`);
  console.log(`  fetch_status : ${JSON.stringify(t1.byFetch)}`);
  console.log(`Phase 2 (scheduler drain)      : final repositories.for_owners=${lastCount}/${unique.length} in ${Math.round((Date.now() - t2Start) / 1000)}s`);
  console.log(`Phase 3 (stability re-fetch)   : ${phase3.length} repos`);
  console.log(`  HTTP statuses: ${JSON.stringify(t3.byStatus)}`);
  console.log(`  fetch_status : ${JSON.stringify(t3.byFetch)}`);

  const phase1Ok =
    phase1Failures.length === 0 && t1.byStatus['200'] === unique.length;
  const phase3Ok =
    t3.byStatus['200'] === unique.length &&
    t3.byFetch['ok'] === unique.length;
  const allGood = phase1Ok && phase3Ok && lastCount === unique.length;

  if (allGood) {
    console.log('\nRESULT: PASS');
    process.exit(0);
  } else {
    console.error('\nRESULT: FAIL');
    console.error(`  Phase 1 all 200/pending : ${phase1Ok ? 'yes' : 'NO'}`);
    console.error(`  Phase 3 all 200/ok      : ${phase3Ok ? 'yes' : 'NO'}`);
    console.error(`  Phase 2 drained to ${unique.length}: ${lastCount === unique.length ? 'yes' : `NO (${lastCount})`}`);
    process.exit(1);
  }
}

main().catch(async (e) => {
  console.error('FATAL', e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
