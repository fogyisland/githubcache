# GitHub Metadata Cache — Implementation Strategy

**Date:** 2026-08-15
**Status:** Draft — pending user review
**Companion spec:** [`2026-08-14-github-metadata-cache-design.md`](./2026-08-14-github-metadata-cache-design.md)
**Project location:** `D:\ToolDevelop\githubcache`

This document is a continuation of the original design. It defines **how** the system gets built — phase boundaries, dependencies between phases, acceptance criteria per phase, risks with fallbacks, and the project-level definition of done. It does not redefine architecture, data model, API contracts, or admin features; those live in the companion spec and remain authoritative.

## 1. Phase Breakdown (M0 – M8)

| Milestone | Name | Scope | End-to-end demo |
|---|---|---|---|
| **M0** | Project skeleton | Next.js 14 (App Router) + TypeScript + Prisma + MySQL + zod config + pino logger + error classes + custom `server.ts` + `GET /api/v1/status` | `curl /api/v1/status` returns `{ok:true, db:'up'}` |
| **M1** | Data path (no auth, no scheduler) | `lib/github/client.ts` (single token) + `lib/github/fields.ts` (only `GET /repos/{owner}/{repo}` for now) + `lib/cache/read.ts` + `lib/cache/write.ts` (UPSERT) + dev CLI script `pnpm dev:fetch owner/name` | `pnpm dev:fetch facebook/react` writes a row to `repositories` with populated `metadata` |
| **M2** | Public API base (no auth) | `POST /api/query` route (parse nodes → hit return / miss fetch) + first happy-path + error-path integration tests + in-memory rate limit | `curl /api/query` returns `facebook/react` metadata; second identical call hits cache |
| **M3** | API key request + approval | `users` table (seed one admin row) + `api_keys` table + admin approves via `/api/admin/api-keys/{id}/approve` (dev-token mode, see §2) + `request_log` records `api_key_id` + public API requires `X-API-Key` | Request → approve → use key → revoke → 403 |
| **M4** | Multi-token pool | `lib/github/pool.ts` (`pickToken` + in-memory map + quota persistence) + `GITHUB_TOKENS_FILE` + 403/quota-exhausted rotation + 429 exponential backoff + `github_tokens` table | 2 tokens via env → run quota-burning script → see automatic switch |
| **M5** | Scheduler + aging | `refresh_jobs` table + `lib/scheduler/` (node-cron 60s tick + `SKIP LOCKED` + 5-min lease) + aging policy (0/1/2+ refreshes → 1h/6h/7d) + failure backoff (5min→15min→1h→6h→24h) + nightly full sweep | Mark 50 repos stale → start → see queue drain and `last_fetched_at` roll forward |
| **M6** | Admin real auth | bcrypt + `sessions` table + `/login` + cookie `ghc_admin_sid` + middleware + CSRF + login throttling + `/admin` dashboard (KPI cards) + delete M3 dev-token endpoint | Admin login → see dashboard → logout → `/admin` redirects to `/login` |
| **M7** | Admin SPA depth | 7 pages + 5 charts fully interactive; time-range selector; per-key limit adjustments write `audit_log`; `/admin/refresh` can pause scheduler; reports queries N+1-free | Admin completes full daily-ops walkthrough |
| **M8** | Graceful degradation + throttling + observability + tests + CI | `GitHubUnavailable` returns cached + `stale:true`; per-key token-bucket; `refresh.failed_review` audit; complete `/api/v1/status`; Vitest unit/integration; GitHub Actions; Dockerfile; deploy doc | Service returns stale data when GitHub blocked; CI green; deployable |

### Design principles
- Each milestone is a small additive step on top of the previous one — no rewrites.
- Each milestone ends with `git tag` for easy rollback.
- Each milestone ships a short "how to demo" paragraph appended to `README.md`.

## 2. Dependency Graph

```
M0 Project skeleton
   │
   ▼
M1 Data path (single token)
   │
   ▼
M2 Public API (no auth) ─────────────────────► M4 token pool
   │                                                  │
   ├──► M3 admin dev-token approval (prod-disabled)  │
   │        │                                          ▼
   │        ▼                                       M5 scheduler
   │       M6 admin real auth (replaces M3 dev-token) │
   │        │                                          │
   │        ▼                                          │
   │       M7 admin SPA full features                  │
   │        │                                          │
   │        └──────────────┬───────────────────────────┘
   │                       ▼
   └──────────────────────► M8 degradation + throttling + observability + tests + CI
```

Reading rules:
- Solid arrows = hard prerequisite (downstream cannot start without upstream).
- The dashed arrow from M2 → M4 indicates a soft parallel (M4's `lib/github/pool.ts` can start before M2 finishes; both need M1).
- M3 and M4 both branch off M2 but converge: M3 → M6, M4 → M5.
- M8 sits downstream of M5, M6, and M7.

### Key dependency constraints

| Upstream | Downstream | Reason |
|---|---|---|
| M0 | M1+ | No skeleton, no work |
| M1 | M2, M4 | M2 needs read/write cache path; M4 needs client abstraction |
| M2 | M3, M5 | M3 needs `request_log.api_key_id` writes; M5 needs cache read path |
| M4 | M5 | Scheduler must run on top of multi-token pool |
| M3 | M6 | M3 uses dev-token; M6 replaces with real auth |
| M6 | M7 | SPA strictly depends on session |
| M5, M7 | M8 | M8 needs both scheduler and admin |

### Recommended execution order
1. **M0** (1–2 days)
2. **M1** (3–5 days, includes Octokit ramp-up)
3. **M2** (3–4 days)
4. **M3** and **M4** partially **parallel**: M4 prioritizes `lib/github/pool.ts` (M5 hard dependency); M3 proceeds with admin approval flow
5. **M5** (5–7 days, biggest uncertainty zone)
6. **M6** (3–4 days)
7. **M7** (7–10 days, largest volume)
8. **M8** (5–7 days)

**Rough total: 30–45 working days** (excluding post-M8 production rollout).

### M3 admin approval note
M3's admin does not really "log in". It uses an env-configured `X-Admin-Dev-Token` header against the approval endpoint (returns 404 when `NODE_ENV === 'production'`). This preserves M3 as a user-valuable milestone without prematurely investing in login UI/session management. M6 deletes the dev-token endpoint outright — no compatibility shim.

### §13.1 of companion spec (git init)
First day of M0: `git init` + commit the companion spec + add `.gitignore`. No later milestone is permitted without a tagged git history.

## 3. Per-Milestone Acceptance Criteria

Each milestone uses four dimensions: function, tests, demo, exit.

### M0 — Project skeleton
- **Function**: `pnpm dev` boots; `GET /api/v1/status` returns `{ok:true, db:'up', tokens:{active:0, exhausted:0}}`; `pnpm typecheck`, `pnpm lint` clean; `pnpm db:migrate` clean; `.env.example` lists every env (values empty); `README.md` has a "5-minute startup" section
- **Tests**: 1 Vitest assertion that `/api/v1/status` returns 503 when MySQL is down
- **Demo**: 30 seconds from fresh clone to running service
- **Exit**: `git tag m0-foundation`, releasable

### M1 — Data path
- **Function**: `pnpm dev:fetch facebook/react` adds a row with full `metadata`, `fetch_status='ok'`; Prisma migration clean; 404 sets `fetch_status='not_found'`
- **Tests**: unit tests cover `lib/cache/read.ts` three states (hit / miss / not_found); 1 integration test intercepts GitHub via MSW
- **Demo**: three outcomes (success / 404 / network timeout)
- **Exit**: `git tag m1-data-path`

### M2 — Public API
- **Function**: `POST /api/query` accepts three node formats (URL / owner/name / `{owner,repo}`), 50-node cap, malformed → 400; cold-data synchronous fetch; repeated requests return in 0ms (DB lookup)
- **Tests**: happy-path (first miss + subsequent hit), error-paths (404, malformed body, >50 nodes), concurrent first-miss (10 parallel requests for same repo → GitHub called once)
- **Demo**: curl 5 nodes; response shows mixed hit/miss
- **Exit**: `git tag m2-public-api`

### M3 — API keys (dev-token mode)
- **Function**: in non-prod, admin uses `X-Admin-Dev-Token` to approve key; key format `ghc_live_<32hex>` shown once, only SHA-256 stored; public API validates `X-API-Key`; unauthorized 401, disabled 403; `request_log.api_key_id` populated
- **Tests**: key uniqueness over 10000 generations; SHA-256 verification path; revocation immediate
- **Demo**: request → approve → use key → revoke → 403
- **Exit**: `git tag m3-api-keys`; dev-token endpoint **must** be deleted in M6

### M4 — Multi-token pool
- **Function**: `GITHUB_TOKENS_FILE` → `github_tokens` rows (first4/last4/token_hash) → in-memory `Map`; `pickToken()` selects by remaining ascending; exhausted rotates to next; 429 exponential backoff (1/2/4/8/16s); quota persisted every 25 calls or 60s; 403 + remaining=0 does not count against quota
- **Tests**: fake-clock verifies backoff timing; 3 tokens simulate sequential exhaustion
- **Demo**: 2 tokens; run 6000-call script; observe switch logs
- **Exit**: `git tag m4-token-pool`

### M5 — Scheduler + aging
- **Function**: node-cron 60s tick; `SELECT ... FOR UPDATE SKIP LOCKED` claim batch; `locked_until = now+5min`; aging 0/1/2+ → 1h/6h/7d; hot-bump (>10 queries/24h → 1h); failure backoff 5min→15min→1h→6h→24h; nightly 03:00 full sweep; 5 consecutive failures write `audit_log`
- **Tests**: testcontainers + real MySQL verify `SKIP LOCKED` concurrency; aging boundaries (just-completed vs completed); failure backoff timing
- **Demo**: mark 50 repos stale (`UPDATE repositories SET last_fetched_at = NOW()-INTERVAL 8 DAY`); start service; watch queue drain
- **Exit**: `git tag m5-scheduler`; survives overnight without backpressure collapse

### M6 — Admin real auth
- **Function**: bcrypt cost 12; `sessions` table + 8h sliding TTL; `ghc_admin_sid` cookie (httpOnly + secure + sameSite=lax); CSRF double-submit; failed-login throttle 5/15min/IP + audit; `/admin/*` middleware; **M3 dev-token endpoint deleted**
- **Tests**: session TTL slide; password reset logs out all; CSRF missing-token rejected; throttle triggers
- **Demo**: login → logout → cookie cleared; 5 wrong passwords → 15-minute lockout
- **Exit**: `git tag m6-admin-auth`; grep verifies dev-token endpoint absent

### M7 — Admin SPA depth
- **Function**: 7 pages + 5 charts interactive; time-range selector (24h/7d/30d/custom); per-key limit adjustments write `audit_log`; `/admin/refresh` can pause scheduler (writes `audit_log`); reports queries N+1-free
- **Tests**: 1 Playwright e2e per page; chart rendering uses server-side Recharts mocks
- **Demo**: admin completes full daily-ops walkthrough (invite → approve → adjust limits → report → pause scheduler)
- **Exit**: `git tag m7-admin-spa`; admin can do all daily work offline

### M8 — Degradation + throttling + observability + tests + CI
- **Function**: `GitHubUnavailable` → API returns cached + `stale:true`; per-key token-bucket (`rate_limit_per_min`, `daily_quota`); `refresh.failed_review` audit trigger; full `/api/v1/status` (db / token / queue depth); GitHub Actions (typecheck / lint / unit / integration / build); multi-stage Dockerfile; deploy README
- **Tests**: network-cut simulation (testcontainers drops MySQL network) → verifies stale path; token-bucket unit tests; CI covers 100% of paths
- **Demo**: firewall block GitHub → API returns old data + `stale:true`; CI PR green
- **Exit**: `git tag m8-prod-ready`; open to external beta

## 4. Risks and Fallbacks

| Milestone | Primary risk | Trigger condition | Fallback strategy | Simplified alternative |
|---|---|---|---|---|
| **M0** | MySQL/Prisma version mismatch | `prisma migrate deploy` complains about Prisma engine version | Downgrade to Prisma 5.x LTS | — |
| **M1** | Octokit response fields differ from docs; bearer token lacks scopes | 1 repo `GET /repos` works but other 6 endpoints 403 | Ship only `/repos`; defer other 6 endpoints to M2 | Defer all 6 to M5 |
| **M2** | Synchronous fetch makes first-miss slow | 50-node full-miss serial → 50 × 8s = 400s | Cap node count at 10; overflow routes to M3+ queue | Keep 50-cap; switch serial to concurrent |
| **M3** | Dev-token accidentally enabled in prod | prod env reaches the endpoint | CI check `if (NODE_ENV === 'production') throw`; grep before each deploy | — |
| **M4** | Quota persistence loss causes GitHub over-calls | Process crash; `requests_used` lags reality | On startup, call `/rate_limit` to correct | Accept over-call (GitHub 403 is just rejection) |
| **M5** | `FOR UPDATE SKIP LOCKED` unavailable on MySQL < 8.0 | Target MySQL is 5.7 | Switch to optimistic lock + unique constraint | Upgrade MySQL 8.0+ (already required by design) |
| **M5** | Scheduler backpressure tanks Node.js | Single tick: 50 repos × 7 endpoints = 350 calls > 60s | Lower batch size + cap concurrency | Disable nightly sweep; incremental only |
| **M6** | bcrypt cost 12 makes login slow | Single login > 500ms | Lower to cost 10 + monitor | — |
| **M7** | Recharts fails under Next.js RSC | `Cannot read 'useState' of undefined` | Wrap all charts in `<ClientOnly>` boundary | Swap to Chart.js or pure SVG |
| **M7** | Reports queries N+1 kill DB | Top-10 query takes 30s | Materialized view or pre-aggregation table | Restrict time range |
| **M8** | GitHub Actions integration times out (5 min) | MSW + testcontainers + Prisma together too slow | Split jobs (unit vs integration); integration uses self-hosted runner | Skip e2e |
| **M8** | Dockerfile multi-stage image too large (>1GB) | `node_modules` retains devDeps | `pnpm deploy` copies only production deps | Accept 800MB single-stage image |

### Cross-milestone risks

- **§13.1 git not initialized**: handle on M0 day 1; no later milestone allowed without tagged history
- **Irreversible DB migrations**: every schema change must be additive (nullable column → backfill → switch to NOT NULL); never drop in one step
- **Env misconfiguration**: `zod` validation must fail-fast; no silent defaults

### Risk monitoring signals (check at each milestone end)
- Single-milestone slip > 50%: pause subsequent; do root-cause analysis
- Test coverage < 80% (`lib/` line coverage): block entry to next milestone
- Production incident preview: no milestone before M5 accepts real traffic

## 5. Project-Level Definition of Done

The whole project reaches "production-ready" only when **all** of the following are true. Any unchecked item means the project is not done.

### F. Functional completeness
Against companion spec §2 Goals:
- [ ] Public API requests return immediately from cache except first-miss (cache hit p95 < 50ms)
- [ ] Hot repos refresh more often than cold ones
- [ ] Multi-token pool auto-rotates with quota tracking
- [ ] GitHub unreachable → cached + `stale:true`
- [ ] Admin can apply/approve/revoke keys without touching DB directly
- [ ] Every admin action audited
- [ ] Single Node.js process, deployable behind any HTTPS reverse proxy

Against §14 Non-Goals (negative checks):
- [ ] No Redis introduced
- [ ] No webhook ingestion
- [ ] No GraphQL public API
- [ ] No OAuth
- [ ] No multi-region replication

### O. Operationally transferable
- [ ] `README.md` has "first deploy" + "daily ops" + "troubleshooting" sections
- [ ] Dockerfile multi-stage build; image < 400MB
- [ ] `docker-compose.yml` includes MySQL + app (dev)
- [ ] DB backup script (`mysqldump` cron) + recovery drill recorded
- [ ] GitHub token rotation runbook (replace / deactivate / emergency revoke)
- [ ] `.env.example` complete; `zod` errors explicit
- [ ] Deploy README includes rollback steps (git tag + image rollback)

### P. Performance benchmarks (one load test at end of M8)
- Cache hit: p95 < 50ms, p99 < 150ms (wrk 100 concurrent, 1000 RPS, 60s)
- Cold miss (single repo): p95 < 8s (bounded by GitHub)
- Scheduler single tick: 50 repos × 7 endpoints = 350 GitHub calls within 60s
- Admin page TTFB < 500ms (no charts), < 1.5s (with charts)

### S. Security review
- [ ] All admin routes require login (middleware coverage verified by grep)
- [ ] API keys never stored in plaintext
- [ ] Password bcrypt cost ≥ 10
- [ ] CSRF protection in place
- [ ] Throttling protects login + public API
- [ ] Audit log not deletable by ordinary admin
- [ ] Dependency scan has no high-severity vulns (`pnpm audit`)
- [ ] Dev-token endpoint absent (verified by grep)
- [ ] `request_log.ip` PII compliance (retention policy confirmed at deploy time)

### T. Test coverage
- [ ] `lib/` line coverage ≥ 80%
- [ ] Every public API route has ≥ 1 happy-path + 1 error-path integration test
- [ ] Scheduler tick tested for concurrency against real MySQL via testcontainers
- [ ] CI fully green; main branch protection requires PR passes CI to merge
- [ ] (Optional) Playwright e2e: login → approve → query → report

### D. Documentation and handover
- [ ] `docs/superpowers/specs/` contains original design + this implementation strategy
- [ ] API doc (consumer view): `/api/query` request/response examples, error codes, rate limit notes
- [ ] Ops runbook: common alerts + remediation steps
- [ ] `CHANGELOG.md` records release notes per M0–M8
- [ ] Internal demo video or screenshots (admin walks through daily ops)

### Release strategy
Once all above are satisfied, two-phase rollout:
1. **Closed beta** (1–2 weeks): invite 5–10 internal users; monitor `request_log` for anomalies
2. **Public beta** (4 weeks later): open registration; monitor scheduler queue depth, token pool consumption, hit rate

Any phase producing ≥ 1 P0 incident rolls back to the prior git tag; post-mortem before reopening.