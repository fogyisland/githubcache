// Load test: hit /api/v1/repos/[owner]/[name] for 100 well-known GitHub
// repos and report back on the system's behaviour. Monitors:
//   - HTTP status counts (200/202/4xx/5xx)
//   - fetch_status distribution (ok/not_found/pending/error)
//   - rate-limit headers
//   - DB growth (repositories, refresh_jobs)
//   - scheduler ticks (pending → in_progress → done)
import { setTimeout as wait } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';

const BASE = process.env.BASE ?? 'http://localhost:5002';
const KEY = process.env.API_KEY ?? 'ghc_live_ddd66d854f590db9633325996a3f2017';
const COOKIE = process.env.COOKIE ?? 'ghc_setup_done=1';

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
  'jaegertracing/jaeger', 'open-telemetry/opentelemetry-go', 'istio/istio', 'linkerd/linkerd2',
  'cncf/cloud-native-devops', 'apple/swift', 'apple/foundation-models', 'swiftlang/swift',
  'openjdk/jdk', 'eclipse-openj9/openj9', 'JetBrains/kotlin', 'kotlin/kotlinx.coroutines',
  'rustdesk/rustdesk', 'lapce/lapce', 'zed-industries/zed', 'helix-editor/helix',
  'neovim/neovim', 'vim/vim', 'emacs-mirror/emacs', 'tree-sitter/tree-sitter',
  'nvim-telescope/telescope.nvim', 'nushell/nushell', 'fish-shell/fish-shell', 'starship/starship',
  'romkatv/powerlevel10k', 'ohmyzsh/ohmyzsh', 'sorin/bond', 'wfxr/forgit',
  'tldr-pages/tldr', 'denisidoro/navi', 'redis/redis', 'memcached/memcached',
  'keydb/keydb', 'dragonflydb/dragonfly', 'apache/kafka', 'apache/pulsar',
  'rabbitmq/rabbitmq-server', 'nats-io/nats-server', 'zeromq/libzmq', 'mongodb/mongo',
  'elastic/logstash', 'fluent/fluentd', 'vector',
];

// Sanity: 100 unique (owner, name)
const seen = new Set();
const unique = REPOS.filter((r) => {
  if (seen.has(r)) return false;
  seen.add(r);
  return true;
});
console.log(`#repos in list: ${unique.length}`);

const prisma = new PrismaClient();

async function getStats(label) {
  const [repos, jobsByStatus, reqLogs] = await Promise.all([
    prisma.repository.count(),
    prisma.refreshJob.groupBy({ by: ['status'], _count: true }),
    prisma.requestLog.count(),
  ]);
  const totalJobs = jobsByStatus.reduce((s, g) => s + g._count, 0);
  console.log(`[${label}] repos=${repos} jobs=${totalJobs} (${jobsByStatus.map((g) => g.status + '=' + g._count).join(',')}) reqLogs=${reqLogs}`);
}

async function probeOne(owner, name) {
  const url = `${BASE}/api/v1/repos/${owner}/${name}`;
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      headers: {
        'x-api-key': KEY,
        cookie: COOKIE,
        'accept': 'application/json',
      },
    });
    const body = await r.text();
    let parsed = null;
    try { parsed = JSON.parse(body); } catch {}
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

async function main() {
  await getStats('BEFORE');

  console.log(`\n=== Phase 1: hammer 100 endpoints in parallel ===`);
  // 10 at a time to avoid hammering the scheduler too hard
  const concurrency = 10;
  const results = [];
  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((r) => probeOne(...r.split('/'))));
    results.push(...batchResults);
    console.log(`  batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(unique.length / concurrency)} done — last: ${batchResults.at(-1)?.status}/${batchResults.at(-1)?.fetchStatus}`);
    // tiny backoff
    await wait(100);
  }

  // Tally
  const byStatus = {};
  const byFetch = {};
  for (const r of results) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (r.fetchStatus) byFetch[r.fetchStatus] = (byFetch[r.fetchStatus] ?? 0) + 1;
  }
  console.log('\n=== Phase 1 results ===');
  console.log('HTTP statuses:', byStatus);
  console.log('fetch_status:', byFetch);
  const totalMs = results.reduce((s, r) => s + (r.ms ?? 0), 0);
  console.log(`total latency ${totalMs}ms, avg ${(totalMs / results.length).toFixed(1)}ms, max ${Math.max(...results.map((r) => r.ms ?? 0))}ms`);

  await getStats('AFTER PHASE 1');

  console.log(`\n=== Phase 2: wait for scheduler (60s tick) to drain queue ===`);
  for (let sec = 0; sec < 180; sec += 10) {
    await wait(10_000);
    await getStats(`+${sec + 10}s`);
    const stillPending = await prisma.refreshJob.count({ where: { status: 'pending' } });
    if (stillPending === 0 && sec >= 60) {
      console.log('  queue drained — stopping wait early');
      break;
    }
  }

  await getStats('FINAL');
  await prisma.$disconnect();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });