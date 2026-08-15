# GitHub Metadata Cache — Design Spec

**Date:** 2026-08-14
**Status:** Draft — pending user review
**Owner:** TBD
**Project location:** `D:\ToolDevelop\githubcache`

## 1. Purpose

A Node.js + Next.js service that acts as a managed GitHub metadata cache:

- Exposes a public HTTPS API (`POST /api/query`) so consumers never call GitHub directly and never hit GitHub's rate limits
- Persists every queried repository to MySQL on first encounter
- Refreshes cached entries in the background using a multi-token GitHub pool
- Provides an admin panel for user management, API key application/approval, GitHub token pool administration, usage reports, and an audit log
- Designed to be operated as a single Node.js process with an in-process scheduler (Option A of the architecture exploration)

The system is fundamentally **"cold/hot data separation + incremental sync"**: the local database is the source of truth for the public API; GitHub is only consulted to fill gaps.

## 2. Goals & Non-Goals

### Goals
- Public API requests always return immediately from cache (except first-miss for new repos, which blocks until GitHub responds)
- Hot repositories refresh more often than cold ones
- Multi-GitHub-token pool with automatic rotation and quota tracking
- Graceful degradation: if GitHub is unreachable, return cached data with `stale: true` rather than failing
- Admin can apply for / approve / revoke API keys without touching the database directly
- Every admin action is auditable
- Single Node.js process deployable behind any HTTPS reverse proxy

### Non-Goals (YAGNI)
- Multi-region replication
- Redis (defer until queue contention appears)
- GitHub webhook ingestion
- Webhook notifications to consumers when data updates
- GraphQL public API (REST only for MVP)
- Per-user OAuth integrations
- Multi-tenant isolation beyond `users.api_keys` ownership

## 3. Architecture

### 3.1 Process Model

A single Node.js process started via a custom `server.ts` that boots Next.js programmatically (so the app runs as a normal long-lived Node.js process, not as serverless functions):

```
┌─────────────────────────────── Single Node.js Process ─────────────────────────────┐
│                                                                                    │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐                 │
│  │ Next.js App  │    │ In-process       │    │ GitHub Token     │                 │
│  │ Router       │    │ Scheduler        │    │ Pool (in-mem)    │                 │
│  │              │    │ (node-cron tick) │    │                  │                 │
│  │ /api/query   │    │                  │    │ Map<id, {raw,    │                 │
│  │ /api/admin/* │◄──►│ drain refresh_   │◄──►│   remaining,     │                 │
│  │ /admin/*     │    │ jobs table       │    │   resetAt}>      │                 │
│  └──────────────┘    └──────────────────┘    └──────────────────┘                 │
│           │                    │                          │                        │
│           └────────────────────┼──────────────────────────┘                        │
│                                ▼                                                  │
│                    ┌────────────────────────┐                                     │
│                    │ lib/ (framework-agnostic)│                                   │
│                    │  db, cache, scheduler,   │                                   │
│                    │  github, auth, api-keys, │                                   │
│                    │  rate-limit, audit, errors│                                  │
│                    └────────────────────────┘                                     │
└────────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │ MySQL 8.0+      │
                              │ (all state)     │
                              └─────────────────┘
```

The `lib/` directory has **zero Next.js imports**, so the scheduler can be lifted into a standalone Node.js process later without code changes.

### 3.2 Module Layout

```
src/
  server.ts                    # entrypoint, boots Next + scheduler
  app/                         # Next.js App Router
    api/
      query/route.ts           # POST /api/query
      admin/
        auth/                  # login/logout/session
        users/                 # user CRUD, invites
        api-keys/              # approve / revoke
        reports/               # usage stats
        audit/                 # audit log query
        github-tokens/         # add/remove tokens
        refresh/               # manual trigger / status
    admin/                     # admin SPA pages
      page.tsx                 # dashboard
      users/page.tsx
      api-keys/page.tsx
      reports/page.tsx
      audit/page.tsx
      github-tokens/page.tsx
      refresh/page.tsx
    layout.tsx                 # public landing + login page
    login/page.tsx             # login form
    request-access/page.tsx    # end-user API key request form
  lib/
    db/                        # Prisma client + migrations
    github/                    # client + token pool + field mapping
    cache/                     # read-through, first-fetch-on-miss
    scheduler/                 # queue drain, aging policy, exponential backoff
    auth/                      # session, password hash, API key generation
    api-keys/                  # approval workflow, key issuance, hashing
    rate-limit/                # per-key token-bucket
    audit/                     # audit log writer
    config/                    # env loading + validation (zod)
    errors/                    # typed error classes + HTTP mapper
    logger/                    # pino structured logger
  middleware.ts                # session/CSRF for admin, API key for public
prisma/
  schema.prisma
  migrations/
tests/
  unit/                        # Vitest unit tests for lib/
  integration/                 # Vitest + testcontainers for routes
  e2e/                         # Playwright (optional, manual for MVP)
```

### 3.3 Key Boundary Rules

- `lib/` is plain TypeScript, no Next.js imports
- App Router routes are thin shells that call into `lib/`
- Scheduler is invoked from `server.ts` at boot and stopped on graceful shutdown
- All cross-layer calls go through typed functions, not raw SQL or HTTP

## 4. Data Model (MySQL 8.0+, managed via Prisma)

### 4.1 `users`
Admin panel users.

| Column          | Type                | Notes                                      |
|-----------------|---------------------|--------------------------------------------|
| id              | BIGINT PK           |                                            |
| email           | VARCHAR(255) UNIQUE |                                            |
| password_hash   | VARCHAR(255)        | bcrypt cost 12                             |
| role            | ENUM('admin','operator') |                                       |
| status          | ENUM('active','disabled') |                                     |
| created_at      | DATETIME            |                                            |
| last_login_at   | DATETIME NULL       |                                            |

### 4.2 `api_keys`
Public API consumers (distinct from `users` — an admin user owns one or more API keys).

| Column            | Type                              | Notes                                      |
|-------------------|-----------------------------------|--------------------------------------------|
| id                | BIGINT PK                         |                                            |
| user_id           | BIGINT FK → users                 | owner (for audit + revoke)                 |
| name              | VARCHAR(100)                      |                                            |
| key_prefix        | VARCHAR(16)                       | first 8 chars of key, for display          |
| key_hash          | VARCHAR(64) UNIQUE                 | SHA-256 of full key                        |
| status            | ENUM('pending','active','revoked')|                                            |
| rate_limit_per_min| INT                               | default 60                                 |
| daily_quota       | INT                               | default 10000                              |
| created_at        | DATETIME                          |                                            |
| approved_at       | DATETIME NULL                     |                                            |
| approved_by       | BIGINT NULL FK → users            |                                            |
| revoked_at        | DATETIME NULL                     |                                            |
| last_used_at      | DATETIME NULL                     |                                            |

### 4.3 `repositories`
Cached repo metadata, keyed by canonical GitHub `owner/name`.

| Column          | Type                              | Notes                                      |
|-----------------|-----------------------------------|--------------------------------------------|
| id              | BIGINT PK                         |                                            |
| owner           | VARCHAR(100)                      | composite unique with name                 |
| name            | VARCHAR(200)                      | composite unique with owner                |
| node            | JSON                              | original input node, for traceability      |
| metadata        | JSON                              | merged GitHub response                     |
| etag            | VARCHAR(64) NULL                  | for conditional GETs                       |
| last_fetched_at | DATETIME NULL                     |                                            |
| fetch_status    | ENUM('ok','not_found','forbidden','error') |                                    |
| fetch_error     | TEXT NULL                         |                                            |
| created_at      | DATETIME                          |                                            |

### 4.4 `refresh_jobs`
Scheduler queue.

| Column         | Type                                | Notes                                      |
|----------------|------------------------------------|--------------------------------------------|
| id             | BIGINT PK                          |                                            |
| repository_id  | BIGINT FK → repositories           |                                            |
| priority       | INT                                | smaller = sooner; default 50               |
| scheduled_for  | DATETIME                           |                                            |
| status         | ENUM('pending','in_progress','done','failed') |                              |
| attempts       | INT                                | default 0                                  |
| last_error     | TEXT NULL                          |                                            |
| locked_until   | DATETIME NULL                      | for lease semantics                        |
| created_at     | DATETIME                           |                                            |
| updated_at     | DATETIME                           |                                            |

Indexes: `(status, scheduled_for)`, `(status, priority)`.

### 4.5 `github_tokens`
Token pool. Raw tokens never persisted.

| Column           | Type                          | Notes                                      |
|------------------|-------------------------------|--------------------------------------------|
| id               | BIGINT PK                     |                                            |
| label            | VARCHAR(100)                  | human-readable                             |
| token_first4     | CHAR(4)                       | for display only                            |
| token_last4      | CHAR(4)                       |                                            |
| token_hash       | CHAR(64) UNIQUE               | SHA-256, used for verification              |
| status           | ENUM('active','disabled')     |                                            |
| requests_used    | INT                           | last known value, persisted for visibility |
| requests_limit   | INT                           | default 5000                                |
| reset_at         | DATETIME NULL                 |                                            |
| last_used_at     | DATETIME NULL                 |                                            |
| created_at       | DATETIME                       |                                            |

### 4.6 `request_log`
Usage analytics (cache hit/miss, latency, status codes).

| Column          | Type                              | Notes                                      |
|-----------------|-----------------------------------|--------------------------------------------|
| id              | BIGINT PK                         |                                            |
| api_key_id      | BIGINT NULL FK → api_keys         | nullable for unauthenticated attempts      |
| endpoint        | VARCHAR(100)                      | e.g. `/api/query`                          |
| repo_requested  | VARCHAR(300) NULL                 | `owner/name`                               |
| cache_hit       | BOOLEAN                           |                                            |
| duration_ms     | INT                               |                                            |
| status_code     | INT                               |                                            |
| ip              | VARCHAR(45)                       |                                            |
| created_at      | DATETIME                          |                                            |

Indexes: `(created_at)`, `(api_key_id, created_at)`.

### 4.7 `audit_log`

| Column        | Type                        | Notes                                      |
|---------------|-----------------------------|--------------------------------------------|
| id            | BIGINT PK                   |                                            |
| actor_user_id | BIGINT NULL FK → users      | nullable for system actions                |
| action        | VARCHAR(100)                | e.g. `api_key.approve`                     |
| target_type   | VARCHAR(50)                 |                                            |
| target_id     | VARCHAR(100)                |                                            |
| metadata      | JSON                        |                                            |
| ip            | VARCHAR(45)                 |                                            |
| created_at    | DATETIME                    |                                            |

### 4.8 `sessions`

| Column      | Type                | Notes                                      |
|-------------|---------------------|--------------------------------------------|
| id          | CHAR(43) PK         | random base64url                            |
| user_id     | BIGINT FK → users   |                                            |
| expires_at  | DATETIME            |                                            |
| created_at  | DATETIME            |                                            |
| ip          | VARCHAR(45)         |                                            |

### 4.9 `invitations`

| Column      | Type                          | Notes                                      |
|-------------|-------------------------------|--------------------------------------------|
| id          | CHAR(32) PK                   | random token                                |
| email       | VARCHAR(255)                  |                                            |
| role        | ENUM('admin','operator')      |                                            |
| invited_by  | BIGINT FK → users             |                                            |
| expires_at  | DATETIME                      | 24h TTL                                     |
| consumed_at | DATETIME NULL                 |                                            |
| created_at  | DATETIME                      |                                            |

## 5. GitHub Client & Token Pool

### 5.1 Token Storage

- Raw tokens come from environment at boot: `GITHUB_TOKENS=token1,token2,token3` OR a JSON file referenced by `GITHUB_TOKENS_FILE` (preferred for prod)
- On boot, server reads tokens, persists `github_tokens` rows (with `token_hash` = SHA-256 of the token for verification; only `first4` + `last4` chars stored for display)
- For runtime calls, an in-memory `Map<tokenId, {raw, remaining, resetAt}>` is kept; the raw token never touches MySQL after boot

### 5.2 Pool Selection (`lib/github/pool.ts` → pickToken())

1. Filter to `status = active` and `reset_at > now`
2. Sort by `remaining` ascending — use the token closest to its limit first (round-robin-ish load balancing)
3. If all exhausted, return null with the earliest `reset_at` for retry hint
4. Caller throws `RateLimitExhausted` → API returns 503 with `Retry-After`

### 5.3 Per-Request Flow (`lib/github/client.ts`)

1. `pickToken()` returns token
2. Call via `@octokit/rest` (typed endpoints)
3. On response: read `x-ratelimit-remaining`, `x-ratelimit-reset` headers; update in-memory map
4. Persist updated quota to MySQL every N requests (default 25) or every 60s to avoid hammering writes
5. On 403 with `x-ratelimit-remaining: 0`: mark token exhausted, retry with next token (up to 3 attempts)
6. On 304 Not Modified: do NOT decrement quota counter (GitHub convention)
7. On 429 (secondary rate limit): exponential backoff retry

### 5.4 Field Mapping (`lib/github/fields.ts`)

For each repo refresh, we hit 7 endpoints (per "core + dynamic" choice):

1. `GET /repos/{owner}/{repo}` — name, description, private, default_branch, stars, forks, watchers, created_at, updated_at, pushed_at, language, license, topics, homepage, archived, disabled
2. `GET /repos/{owner}/{repo}/languages` — language breakdown
3. `GET /repos/{owner}/{repo}/readme` — base64-decoded, truncated to 64KB
4. `GET /repos/{owner}/{repo}/releases/latest`
5. `GET /repos/{owner}/{repo}/contributors?per_page=10`
6. `GET /repos/{owner}/{repo}/issues?state=closed&per_page=10`
7. `GET /repos/{owner}/{repo}/dependency-graph/snapshots`

All responses merged into one normalized object stored in `repositories.metadata`.

**Failure handling:** secondary endpoint failures don't fail the whole refresh. Primary `/repos` data still gets cached; failures recorded in `metadata._partial_errors`.

### 5.5 GraphQL Batch Path

When ≥3 new repos are missed in a single `/api/query` request, batch into a single GraphQL query using aliased fragments — instead of N×7 REST calls. This is the optimization from the cold/hot separation design refinement.

## 6. Cache & Refresh Scheduler

### 6.1 Read Path (`lib/cache/read.ts` → getRepoMetadata)

1. Lookup `repositories` by `(owner, name)`
2. **Hit:** return `metadata` immediately (no GitHub call)
3. **Miss:** enqueue a `refresh_jobs` row with priority 10 (high), fetch from GitHub **synchronously** to populate cache, return

- Synchronous first-miss fetch is the only time the public API blocks on GitHub — bounded to a single repo per request
- Concurrent first-miss for same repo collapsed via in-process promise map (`pendingRepoFetches: Map<string, Promise<...>>`)

### 6.2 Bulk-Miss Handling

If all 50 nodes in a request miss:
- Fetch first 3 synchronously
- Queue the remaining 47 as high-priority `refresh_jobs`
- Return results with `pending: true` flag for queued entries
- Scheduler will pick them up in the next tick

### 6.3 Write Path (`lib/cache/write.ts` → storeRepoMetadata)

1. UPSERT `repositories` (merge metadata)
2. Enqueue next refresh in `refresh_jobs` per aging schedule (see §6.5)
3. Append `request_log` entry (cache miss only)

### 6.4 Scheduler (`lib/scheduler/`)

In-process via `node-cron` ticks every 60 seconds. Two modes share the same queue:

**Mode A — Daytime Incremental (continuous)**

Each tick:
1. SELECT next `SCHEDULER_BATCH_SIZE` `pending` jobs (default 50) WHERE `scheduled_for <= now` AND (`locked_until IS NULL OR locked_until < now`), ORDER BY `priority ASC, scheduled_for ASC` — using `FOR UPDATE SKIP LOCKED` (MySQL 8.0+)
2. Mark `locked_until = now + 5 min`, `status = in_progress`, `attempts++`
3. For each job, call `refreshOne(repoId)`:
   - Load repo + last `etag`
   - **Conditional GET**: `If-None-Match` against `/repos/{owner}/{name}` — if 304, skip all 7 endpoints (nothing changed at root), update `last_fetched_at`, reschedule next refresh (no quota consumed)
   - If 200, fetch all 7 endpoints, merge, write, schedule next refresh
   - On 404/410: write `fetch_status = not_found`, reschedule in 24h
   - On 403 (forbidden/private): write `fetch_status = forbidden`, audit_log entry, don't requeue
   - On 429: release lock, don't count attempt, retry with exponential backoff (1s, 2s, 4s, 8s, 16s)
   - On network error: throw `GitHubUnavailable`, reschedule with backoff
4. Mark job `done` or `failed`

**Mode B — Nightly Full Sweep (cron `0 3 * * *` local, configurable via `NIGHTLY_SWEEP_CRON`)**

- For each row in `repositories` with `fetch_status = 'ok'`, enqueue a refresh_job with `priority = 99` and `scheduled_for = now`
- Daytime ticks drain this batch naturally — single backpressure mechanism, no separate worker

### 6.5 Aging Schedule (`lib/scheduler/aging.ts`)

After a successful refresh, schedule next per refresh count:
- 0 refreshes done → 1 hour
- 1 refresh done → 6 hours
- 2+ refreshes done → 7 days (steady state)

**Hot bump override:** if `request_log` shows >10 queries for this repo in last 24h, schedule next in 1 hour regardless.

**Failure backoff:** 5 min → 15 min → 1 hour → 6 hours → 24 hours. After 5 consecutive failures: write to `audit_log` and flag repo for admin review.

### 6.6 Graceful Degradation

`lib/github/client.ts` wraps Octokit in try/catch. On network error (not API 4xx/5xx), throws `GitHubUnavailable`. Read path catches this, returns cached metadata with `stale: true` flag and `warning: 'data may be delayed'`. Refresh jobs retry with backoff.

## 7. Public API

### 7.1 Endpoint

`POST /api/query`

### 7.2 Request Body

```json
{
  "nodes": [
    "https://github.com/facebook/react",
    "vercel/next.js",
    { "owner": "vuejs", "repo": "core" }
  ]
}
```

Each node can be:
- Full URL: `https://github.com/owner/repo`
- `owner/repo` shorthand
- `{owner, repo}` object

Parser normalizes all three to canonical `(owner, name)`. Max 50 nodes per request (over → 400).

### 7.3 Auth

`X-API-Key: <key>` header.
- Missing/invalid → 401
- Disabled/revoked key → 403

### 7.4 Response (200)

```json
{
  "results": [
    {
      "node": "https://github.com/facebook/react",
      "canonical": "facebook/react",
      "found": true,
      "stale": false,
      "metadata": { /* merged GitHub data */ },
      "last_fetched_at": "2026-08-13T...",
      "fetch_status": "ok"
    },
    {
      "canonical": "vuejs/core",
      "found": false,
      "fetch_status": "not_found",
      "error": "Repository not found or private"
    }
  ],
  "summary": { "hit": 1, "miss": 1, "stale": 0 }
}
```

### 7.5 Other Endpoints

- `GET /api/v1/status` — health check, returns token pool summary (no auth)
- `GET /api/v1/me` — current API key info: quota usage, rate limit (auth required)

### 7.6 Rate Limiting

Per-API-key token-bucket:
- `rate_limit_per_min` requests/min (configurable per key, default 60)
- `daily_quota` requests/day (configurable per key, default 10000)
- 429 with `Retry-After` and `X-RateLimit-Remaining` headers

### 7.7 Error Codes

- `400` malformed request body
- `401` missing/invalid API key
- `403` key disabled/revoked or repo forbidden
- `429` rate limited
- `503` GitHub fully unavailable (returns cached data + `stale: true` per node if any)

## 8. Admin Authentication & API Key Approval

### 8.1 Admin Authentication

- Email + password login → `POST /api/admin/auth/login`
- Password hashed with `bcrypt` (cost 12)
- Session: signed HttpOnly cookie, server-side session store (`sessions` table)
- Cookie name: `ghc_admin_sid`, secure + httpOnly + sameSite=lax
- Session TTL: 8 hours, sliding renewal on activity
- **CSRF protection**: double-submit cookie — `ghc_csrf` cookie + `X-CSRF-Token` header on all mutating requests
- Failed login: rate-limited (5 attempts / 15 min / IP), audit-logged

### 8.2 Self-Registration

No public registration. Admin invites new users via `POST /api/admin/users/invite { email, role }` — generates one-time signup link (24h TTL). Invited user clicks link, sets password → account active.

### 8.3 API Key Approval Workflow

End-user flow:
1. Admin pre-creates `users` account (or existing user logs in)
2. User logs in → requests API keys via `POST /api/admin/api-keys/request { name, intended_use }` → status `pending`
3. Admin sees pending requests in `/admin/api-keys`
4. Admin reviews, sets rate limit + daily quota, approves → `POST /api/admin/api-keys/{id}/approve`
5. **One-time key reveal**: on approval, system generates `ghc_live_<32hex>`, shows ONCE to admin to relay to user. Stores SHA-256 hash only. **Key is never recoverable later.**
6. User configures their client, hits `/api/query`
7. Revoke: `POST /api/admin/api-keys/{id}/revoke` — sets status `revoked`, key stops working immediately

All approval/revocation events written to `audit_log`.

### 8.4 Roles

- `admin` — full access (manage users, approve keys, see reports)
- `operator` — approve/revoke keys, view reports; cannot manage users

### 8.5 Session Security

- Sessions invalidated on password change
- `last_login_at` updated on each successful login
- "Logout everywhere" feature: admin invalidates all sessions for a user

## 9. Admin Features & SPA

### 9.1 Pages

| Path                    | Roles          | Purpose                                              |
|-------------------------|----------------|------------------------------------------------------|
| `/login`                | public         | Email + password login                               |
| `/request-access`       | public         | End-user API key request form (requires invitation)  |
| `/admin`                | admin+operator | Dashboard                                            |
| `/admin/users`          | admin          | User CRUD, invite, reset pwd, disable, logout-all    |
| `/admin/api-keys`       | admin+operator | Filterable table of API keys                         |
| `/admin/api-keys/[id]`  | admin+operator | Per-key detail + adjustment + revocation             |
| `/admin/github-tokens`  | admin          | Token pool management                                |
| `/admin/reports`        | admin+operator | Time-range usage reports with charts                 |
| `/admin/refresh`        | admin+operator | Manual refresh, queue stats, scheduler pause         |
| `/admin/audit`          | admin          | Searchable audit log                                  |

### 9.2 Dashboard

KPI cards: total API keys (active/pending/revoked), 24h request volume, cache hit rate, GitHub token pool health. Recent activity feed (last 20 audit entries).

### 9.3 Reports

Time-range selector (24h / 7d / 30d / custom). Charts:
- Requests over time (line)
- Hit rate over time (line)
- Top 10 most-queried repos (bar)
- Top 10 active API keys (bar)
- GitHub token quota consumption (stacked area)

Per-API-key drill-down page.

### 9.4 SPA Stack

- Next.js App Router pages
- React Server Components for initial data load
- Client components for interactivity (filters, charts, modals)
- Tailwind CSS for styling
- Recharts for charts
- Auth: middleware-based session check on `/admin/*` redirects to `/login` if no valid session

## 10. Error Handling, Logging, Monitoring

### 10.1 Error Classes (`lib/errors/`)

- `AppError` (base)
- `GitHubError` (API 4xx/5xx)
- `RateLimitError` (token pool exhausted)
- `GitHubUnavailable` (network/down)
- `AuthError`
- `NotFoundError`
- `ValidationError`

Each has `code` (string for API clients), `http_status`, optional `retry_after`.

### 10.2 Concrete Error Flows

| Trigger                          | Behavior                                                                                     |
|----------------------------------|----------------------------------------------------------------------------------------------|
| GitHub 5xx / network error       | `GitHubUnavailable` → API returns cached + `stale:true`; scheduler retries with backoff      |
| GitHub 404/410                   | `fetch_status = not_found`, don't requeue for 24h                                            |
| GitHub 403 (private/forbidden)   | `fetch_status = forbidden`, audit_log entry, don't requeue                                   |
| GitHub 429 (secondary limit)     | Token pool rotates, exponential backoff (1s, 2s, 4s, 8s, 16s)                               |
| DB connection failure            | Server stays up, returns 503 + cached where possible                                          |
| Unhandled exception              | Next.js error boundary → 500 generic message; full stack logged; admin audit entry           |

### 10.3 Logging

Structured logging via `pino` with `request_id`, `user_id`, `api_key_id` correlation. Log level via `LOG_LEVEL` env var.

### 10.4 Monitoring

- Token pool exhaustion surfaced in `/admin/github-tokens` + dashboard KPI
- Repeated refresh failures → audit_log entries with `action='refresh.failed_review'` (admin reviews via `/admin/audit?action=refresh.failed_review`)
- Health endpoint `GET /api/v1/status` reports `db: 'up'`, token pool summary

## 11. Testing Strategy

### 11.1 Unit (Vitest)
- `lib/github/pool.ts` — token rotation with fake clock
- `lib/scheduler/aging.ts` — aging schedule edge cases
- `lib/cache/read.ts`, `lib/cache/write.ts` — first-miss / hit / stale paths
- `lib/auth/*` — password hash, session, API key generation
- `lib/api-keys/*` — approval workflow transitions
- Error class mapping

### 11.2 Integration (Vitest + testcontainers)
- API endpoints against real MySQL fixture
- Scheduler tick against real MySQL
- Octokit calls recorded with MSW (no real GitHub calls in tests)

### 11.3 End-to-End (Playwright, optional for MVP)
- Admin login → approve API key → use key to query → see request in reports
- Trigger refresh → see queue progress

### 11.4 TDD Discipline

Every `lib/` function written test-first. Every API route has at least one happy-path + one error-path integration test.

## 12. Project Setup & Deployment

### 12.1 Scripts

```json
{
  "dev": "next dev + tsc --watch",
  "build": "next build + tsc",
  "start": "node dist/server.js",
  "test": "vitest run",
  "test:e2e": "playwright test",
  "db:migrate": "prisma migrate deploy",
  "db:generate": "prisma generate",
  "lint": "eslint",
  "typecheck": "tsc --noEmit"
}
```

### 12.2 Environment Variables (validated via zod at boot)

```
DATABASE_URL=mysql://...
GITHUB_TOKENS=token1,token2              # or GITHUB_TOKENS_FILE
ADMIN_INVITE_SECRET=...
SESSION_SECRET=...
PORT=3000
NODE_ENV=production
NIGHTLY_SWEEP_CRON=0 3 * * *
SCHEDULER_TICK_MS=60000
REPO_FETCH_TIMEOUT_MS=10000
README_MAX_BYTES=65536
LOG_LEVEL=info
DATABASE_POOL_SIZE=10
TOKEN_QUOTA_PERSIST_INTERVAL_MS=60000
TOKEN_QUOTA_PERSIST_EVERY_N=25
SCHEDULER_BATCH_SIZE=50
RETRY_BACKOFF_SCHEDULE=1s,2s,4s,8s,16s
```

### 12.3 Boot Sequence

1. `prisma migrate deploy`
2. Load env, validate with zod
3. Initialize Prisma client
4. Read GitHub tokens from env / file → populate `github_tokens` table → build in-memory pool map
5. Boot Next.js (`next()`)
6. Start scheduler (`node-cron`)
7. Listen on `PORT`

### 12.4 Graceful Shutdown

- Stop scheduler tick (no new jobs claimed)
- Drain in-flight requests (Next.js handles)
- Close DB pool
- Exit 0 on SIGTERM / SIGINT

### 12.5 Health Check

`GET /api/v1/status` → `{ ok: true, db: 'up', tokens: { active: 3, exhausted: 0 } }`

## 13. Open Questions for User Review

None — all clarifications resolved during brainstorming.

### 13.1 Repository Initialization Note

`D:\ToolDevelop` is not currently a git repository. When the implementation phase begins, the first step should be `git init` in `D:\ToolDevelop\githubcache` and an initial commit of this spec. Confirm before proceeding.

## 14. Out of Scope (Explicit)

- Multi-region replication
- Redis caching layer (defer until queue contention appears)
- GitHub webhook ingestion
- Webhook notifications to consumers
- GraphQL public API
- Per-user OAuth integrations
- Multi-tenant isolation beyond `users.api_keys` ownership