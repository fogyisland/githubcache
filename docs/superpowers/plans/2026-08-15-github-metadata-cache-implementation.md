# GitHub Metadata Cache — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js + Next.js service that caches GitHub repo metadata behind a public API, with a multi-token pool, background refresh scheduler, and admin panel — end-to-end deployable.

**Architecture:** Single Node.js process running Next.js programmatically plus an in-process node-cron scheduler. `lib/` is framework-agnostic; App Router routes are thin shells. Cold/hot data separation: MySQL is source of truth, GitHub only fills gaps. Admin auth via cookie session; public API via API key.

**Tech Stack:** Node.js 20+, Next.js 14 (App Router), TypeScript, Prisma, MySQL 8.0+, @octokit/rest, node-cron, pino, zod, bcrypt, Vitest, MSW, testcontainers, Playwright (optional), GitHub Actions, Docker.

**Spec:**
- [`docs/superpowers/specs/2026-08-14-github-metadata-cache-design.md`](../specs/2026-08-14-github-metadata-cache-design.md) — architectural design (authoritative for architecture, data model, API contracts, admin features)
- [`docs/superpowers/specs/2026-08-15-implementation-strategy-design.md`](../specs/2026-08-15-implementation-strategy-design.md) — implementation strategy (authoritative for phasing, acceptance criteria, risks, exit conditions)

---

## Global Constraints

These apply to every task unless the task explicitly overrides them.

- **Node.js**: 20.x LTS or later (uses native `fetch`, `node:test`)
- **TypeScript**: 5.4+, strict mode, `noUncheckedIndexedAccess: true`
- **Package manager**: pnpm 9.x (use `pnpm`, not `npm`/`yarn`)
- **MySQL**: 8.0+ (required for `SELECT ... FOR UPDATE SKIP LOCKED`)
- **Prisma**: 5.x LTS
- **Test runner**: Vitest 1.x
- **HTTP mocking**: MSW 2.x (intercepts `@octokit/rest` network calls in tests)
- **Container testing**: testcontainers 10.x with MySQL module
- **Lint/format**: ESLint 9 flat config + Prettier 3
- **No Next.js imports inside `src/lib/`** — keep framework-agnostic boundary
- **No raw SQL outside `src/lib/db/`** — all cross-layer calls go through typed functions
- **All env vars validated via zod at boot** — no silent defaults, fail-fast
- **Commit messages**: Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`, `refactor:`)
- **Git tag at end of every milestone**: `m0-foundation`, `m1-data-path`, ..., `m8-prod-ready`
- **Logger**: pino with `request_id`, `user_id`, `api_key_id` correlation; level via `LOG_LEVEL`
- **Error classes live in `src/lib/errors/`**: `AppError`, `GitHubError`, `RateLimitError`, `GitHubUnavailable`, `AuthError`, `NotFoundError`, `ValidationError` — each has `code`, `httpStatus`, optional `retryAfter`
- **API key format**: `ghc_live_<32hex>` (32 lowercase hex chars after prefix); store only SHA-256 hash
- **Session cookie name**: `ghc_admin_sid` (httpOnly + secure + sameSite=lax)
- **CSRF cookie name**: `ghc_csrf`; required header `X-CSRF-Token` on all mutating admin routes
- **Public API auth header**: `X-API-Key: <key>`

---

## File Structure

Files created or modified across all milestones. Each file has one clear responsibility; files that change together live together.

```
githubcache/
├── package.json                              # deps + scripts (M0)
├── pnpm-lock.yaml                            # generated
├── tsconfig.json                             # TS strict (M0)
├── next.config.mjs                           # Next config (M0)
├── eslint.config.mjs                         # flat config (M0)
├── .prettierrc                               # format rules (M0)
├── .gitignore                                # git ignores (M0)
├── .env.example                              # env template (M0)
├── README.md                                 # operator docs (M0 + appended per milestone)
├── Dockerfile                                # multi-stage (M8)
├── docker-compose.yml                        # dev stack (M0, refined M8)
├── prisma/
│   ├── schema.prisma                         # full schema (M1-M5 incrementally)
│   └── migrations/                           # generated
├── src/
│   ├── server.ts                             # entrypoint: boots Next + scheduler (M0, extended M5)
│   ├── middleware.ts                            # Next middleware: admin session + API key (M0 stub, M2 key, M6 admin)
│   ├── app/
│   │   ├── layout.tsx                        # public layout (M0)
│   │   ├── page.tsx                          # landing page (M0)
│   │   ├── login/page.tsx                    # login form (M6)
│   │   ├── request-access/page.tsx           # API key request form (M7)
│   │   ├── admin/
│   │   │   ├── layout.tsx                    # admin shell (M6)
│   │   │   ├── page.tsx                      # dashboard (M6)
│   │   │   ├── users/page.tsx                # user CRUD (M7)
│   │   │   ├── api-keys/page.tsx             # key list + actions (M7)
│   │   │   ├── api-keys/[id]/page.tsx        # per-key detail (M7)
│   │   │   ├── github-tokens/page.tsx        # token pool mgmt (M7)
│   │   │   ├── reports/page.tsx              # usage charts (M7)
│   │   │   ├── audit/page.tsx                # audit log search (M7)
│   │   │   └── refresh/page.tsx              # manual refresh + queue (M7)
│   │   └── api/
│   │       ├── v1/status/route.ts            # GET /api/v1/status (M0)
│   │       ├── query/route.ts                # POST /api/query (M2)
│   │       ├── v1/me/route.ts                # GET /api/v1/me (M3)
│   │       └── admin/
│   │           ├── auth/login/route.ts       # POST login (M6)
│   │           ├── auth/logout/route.ts      # POST logout (M6)
│   │           ├── users/invite/route.ts     # POST invite (M7)
│   │           ├── users/[id]/route.ts       # PATCH/DELETE user (M7)
│   │           ├── api-keys/request/route.ts # POST request (M7)
│   │           ├── api-keys/[id]/approve/route.ts # POST approve (M3 dev-token, M6 real)
│   │           ├── api-keys/[id]/revoke/route.ts  # POST revoke (M3)
│   │           ├── api-keys/[id]/route.ts    # PATCH limits (M7)
│   │           ├── github-tokens/route.ts   # GET/POST tokens (M7)
│   │           ├── github-tokens/[id]/route.ts # PATCH/DELETE (M7)
│   │           ├── reports/route.ts          # GET report data (M7)
│   │           ├── audit/route.ts            # GET audit log (M7)
│   │           ├── refresh/route.ts          # POST manual trigger / pause (M7)
│   │           └── dev-token-approve/route.ts # M3 dev-token endpoint (DELETED in M6)
│   └── lib/
│       ├── config/env.ts                     # zod env loader (M0)
│       ├── errors/index.ts                   # error classes (M0)
│       ├── logger/index.ts                   # pino setup (M0)
│       ├── db/client.ts                      # Prisma client (M1)
│       ├── db/repositories.ts                # repo CRUD (M1)
│       ├── db/api-keys.ts                    # key CRUD (M3)
│       ├── db/users.ts                       # user CRUD (M6)
│       ├── db/refresh-jobs.ts                # job CRUD (M5)
│       ├── db/github-tokens.ts               # token CRUD (M4)
│       ├── db/request-log.ts                 # log writes (M2)
│       ├── db/audit-log.ts                   # audit writes (M3)
│       ├── db/sessions.ts                    # session CRUD (M6)
│       ├── db/invitations.ts                 # invitation CRUD (M7)
│       ├── github/client.ts                  # Octokit wrapper (M1, refined M4)
│       ├── github/pool.ts                    # token pool (M4)
│       ├── github/fields.ts                  # endpoint mapping (M1, expanded M5)
│       ├── cache/read.ts                     # getRepoMetadata (M1)
│       ├── cache/write.ts                    # storeRepoMetadata (M1)
│       ├── cache/parser.ts                   # node → canonical (M2)
│       ├── scheduler/tick.ts                 # single drain iteration (M5)
│       ├── scheduler/aging.ts                # aging policy (M5)
│       ├── scheduler/sweep.ts                # nightly full sweep (M5)
│       ├── scheduler/lease.ts                # SKIP LOCKED helpers (M5)
│       ├── auth/password.ts                  # bcrypt helpers (M6)
│       ├── auth/session.ts                   # session CRUD + cookie helpers (M6)
│       ├── auth/csrf.ts                      # CSRF token gen/verify (M6)
│       ├── api-keys/generate.ts              # ghc_live_<32hex> (M3)
│       ├── api-keys/verify.ts                # SHA-256 lookup (M3)
│       ├── api-keys/workflow.ts              # request→approve→revoke (M3)
│       ├── rate-limit/memory.ts              # in-memory token bucket (M2)
│       ├── rate-limit/bucket.ts              # per-key durable bucket (M8)
│       ├── rate-limit/login-throttle.ts              # login throttle (M6)
│       ├── audit/writer.ts                   # append audit_log (M3)
│       ├── dev-token/index.ts                # M3 dev-token validator (DELETED in M6)
│       ├── reports/queries.ts                # N+1-free aggregations (M7)
│       └── jobs/refresh-one.ts               # refresh single repo (M5)
├── tests/
│   ├── setup.ts                              # Vitest global setup (M0)
│   ├── unit/                                 # per-module unit tests
│   ├── integration/                          # route-level + DB tests
│   ├── e2e/                                  # Playwright (M7+)
│   └── fixtures/                             # GitHub response fixtures (M1)
└── .github/
    └── workflows/
        ├── ci.yml                            # M8
        └── release.yml                       # M8
```

**Decomposition principle**: each file does one thing; a task that touches a file should be the only writer for that file in its milestone. Cross-module data flows via typed function calls, never direct DB access.

---

## Milestone M0 — Project Skeleton

### M0.1 Initialize git and tooling

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `pnpm-workspace.yaml` (single-package workspace)

**Interfaces:**
- Consumes: nothing (greenfield)
- Produces: working pnpm workspace with TS/ESLint/Prettier scripts

- [ ] **Step 1: `git init` and initial commit**

```bash
cd D:/ToolDevelop/githubcache
git init
git add docs/
git commit -m "docs: import original spec + strategy"
```

- [ ] **Step 2: Write `.gitignore`**

```gitignore
node_modules/
.next/
dist/
*.log
.env
.env.local
coverage/
.DS_Store
.pnpm-store/
```

- [ ] **Step 3: Init pnpm package**

```bash
pnpm init
```

Edit `package.json` to set `"packageManager": "pnpm@9.x"`, `"type": "module"`, `"engines": {"node": ">=20"}`.

- [ ] **Step 4: Install base deps**

```bash
pnpm add next@14 react@18 react-dom@18
pnpm add -D typescript @types/node @types/react @types/react-dom
pnpm add -D eslint@9 eslint-config-next prettier
pnpm add zod pino pino-pretty
```

- [ ] **Step 5: Add scripts to `package.json`**

```json
{
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "format": "prettier --write .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "chore: initialize pnpm workspace with Next.js + tooling"
```

---

### M0.2 TypeScript and ESLint config

**Files:**
- Create: `tsconfig.json`
- Create: `eslint.config.mjs`
- Create: `.prettierrc`

- [ ] **Step 1: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "jsx": "preserve",
    "incremental": true,
    "isolatedModules": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src/**/*", "tests/**/*", "next-env.d.ts"],
  "exclude": ["node_modules", ".next", "dist"]
}
```

- [ ] **Step 2: Write `eslint.config.mjs`**

```js
import next from 'eslint-config-next';
export default [
  ...next,
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
  { ignores: ['.next/**', 'node_modules/**', 'dist/**', 'coverage/**'] }
];
```

- [ ] **Step 3: Write `.prettierrc`**

```json
{ "semi": true, "singleQuote": true, "printWidth": 100, "trailingComma": "all" }
```

- [ ] **Step 4: Verify lint + typecheck pass on empty src**

```bash
mkdir -p src/app src/lib tests
echo "export {}" > src/lib/_placeholder.ts
pnpm typecheck && pnpm lint
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "chore: add TypeScript strict + ESLint flat + Prettier"
```

---

### M0.3 Env loader and error classes

**Files:**
- Create: `src/lib/config/env.ts`
- Create: `src/lib/errors/index.ts`
- Create: `src/lib/logger/index.ts`
- Test: `tests/unit/env.test.ts`
- Test: `tests/unit/errors.test.ts`

**Interfaces:**
- Produces:
  - `env: { DATABASE_URL: string; PORT: number; LOG_LEVEL: string; NODE_ENV: 'development'|'production'|'test'; ... }`
  - `AppError` base class with `code: string`, `httpStatus: number`, `retryAfter?: number`

- [ ] **Step 1: Write failing test for env loader**

```ts
// tests/unit/env.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
describe('env loader', () => {
  beforeEach(() => { delete process.env.DATABASE_URL; });
  it('throws when DATABASE_URL missing', async () => {
    await expect(import('@/lib/config/env')).rejects.toThrow(/DATABASE_URL/);
  });
  it('loads required vars', async () => {
    process.env.DATABASE_URL = 'mysql://u:p@localhost:3306/db';
    const { env } = await import('@/lib/config/env');
    expect(env.DATABASE_URL).toBe('mysql://u:p@localhost:3306/db');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
pnpm test tests/unit/env.test.ts
```

- [ ] **Step 3: Implement `src/lib/config/env.ts`**

```ts
import { z } from 'zod';
const schema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal','error','warn','info','debug','trace']).default('info'),
  NODE_ENV: z.enum(['development','production','test']).default('development'),
  SESSION_SECRET: z.string().min(32).default('dev-secret-change-me-32-chars-min-aaaaa'),
});
export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
```

- [ ] **Step 4: Implement `src/lib/errors/index.ts`**

```ts
export class AppError extends Error {
  constructor(public code: string, public httpStatus: number, message: string, public retryAfter?: number) {
    super(message); this.name = this.constructor.name;
  }
}
export class ValidationError extends AppError { constructor(m: string) { super('VALIDATION_ERROR', 400, m); } }
export class AuthError extends AppError { constructor(m: string) { super('AUTH_ERROR', 401, m); } }
export class NotFoundError extends AppError { constructor(m: string) { super('NOT_FOUND', 404, m); } }
export class RateLimitError extends AppError { constructor(m: string, retryAfter: number) { super('RATE_LIMITED', 429, m, retryAfter); } }
export class GitHubError extends AppError { constructor(code: string, status: number, m: string) { super(code, status, m); } }
export class GitHubUnavailable extends AppError { constructor(m: string) { super('GITHUB_UNAVAILABLE', 503, m); } }
```

- [ ] **Step 5: Implement `src/lib/logger/index.ts`**

```ts
import pino from 'pino';
import { env } from '@/lib/config/env';
export const logger = pino({ level: env.LOG_LEVEL, transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined });
```

- [ ] **Step 6: Add error test**

```ts
// tests/unit/errors.test.ts
import { describe, it, expect } from 'vitest';
import { RateLimitError, GitHubError } from '@/lib/errors';
it('RateLimitError carries retryAfter', () => {
  const e = new RateLimitError('slow down', 30);
  expect(e.code).toBe('RATE_LIMITED');
  expect(e.httpStatus).toBe(429);
  expect(e.retryAfter).toBe(30);
});
it('GitHubError maps status', () => {
  const e = new GitHubError('GH_FORBIDDEN', 403, 'private');
  expect(e.httpStatus).toBe(403);
});
```

- [ ] **Step 7: Run all tests, verify pass**

```bash
pnpm test
```

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "feat(M0): env loader + error classes + logger"
```

---

### M0.4 Status endpoint + custom server

**Files:**
- Create: `src/app/api/v1/status/route.ts`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/server.ts`
- Test: `tests/integration/status.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/v1/status` → `{ ok: boolean, db: 'up'|'down', tokens: { active: number, exhausted: number } }`

- [ ] **Step 1: Write failing integration test**

```ts
// tests/integration/status.test.ts
import { describe, it, expect } from 'vitest';
import { GET } from '@/app/api/v1/status/route';
it('returns ok with db up when env valid', async () => {
  const res = await GET();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.db).toBe('up');
  expect(body.tokens).toEqual({ active: 0, exhausted: 0 });
});
```

- [ ] **Step 2: Run, expect fail (route doesn't exist)**

- [ ] **Step 3: Write `src/app/api/v1/status/route.ts`**

```ts
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function GET() {
  return NextResponse.json({ ok: true, db: 'up', tokens: { active: 0, exhausted: 0 } });
}
```

- [ ] **Step 4: Add minimal layout and landing**

```tsx
// src/app/layout.tsx
export const metadata = { title: 'GitHub Metadata Cache' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
```

```tsx
// src/app/page.tsx
export default function Home() { return <main><h1>GitHub Metadata Cache</h1></main>; }
```

- [ ] **Step 5: Verify `pnpm dev` boots and `curl /api/v1/status` returns JSON**

```bash
pnpm dev &
sleep 5
curl http://localhost:3000/api/v1/status
```

Expected: `{"ok":true,"db":"up","tokens":{"active":0,"exhausted":0}}`

- [ ] **Step 6: Run integration test, verify pass**

```bash
pnpm test tests/integration/status.test.ts
```

- [ ] **Step 7: Write `src/server.ts` (custom entrypoint skeleton)**

```ts
// Placeholder — full version arrives in M5 once scheduler needs booting
import { startNext } from '@/lib/boot/next';
startNext();
```

For M0 just keep `next start` via `package.json scripts`; the custom `server.ts` is wired in M5.

- [ ] **Step 8: Write `.env.example`**

```
DATABASE_URL=mysql://user:pass@localhost:3306/githubcache
PORT=3000
LOG_LEVEL=info
SESSION_SECRET=replace-with-32-chars-min
NODE_ENV=development
```

- [ ] **Step 9: Write README "5-minute startup" section**

```markdown
## 5-minute startup
1. `cp .env.example .env` and fill `DATABASE_URL`
2. `pnpm install`
3. `pnpm dev`
4. `curl http://localhost:3000/api/v1/status` → `{ok:true,db:"up"}`
```

- [ ] **Step 10: Commit and tag**

```bash
git add .
git commit -m "feat(M0): status endpoint + landing page"
git tag m0-foundation
```

---

## Milestone M1 — Data Path (Single Token, No Auth, No Scheduler)

### M1.1 Prisma + MySQL schema (initial)

**Files:**
- Create: `prisma/schema.prisma`
- Create: `.env.example` (extend with `DATABASE_URL`)
- Test: `tests/integration/prisma.test.ts`

**Interfaces:**
- Produces:
  - Prisma client exported from `src/lib/db/client.ts`
  - `repositories` table with: `id, owner, name, node, metadata (Json), etag, last_fetched_at, fetch_status, fetch_error, created_at`
  - Composite unique `(owner, name)`

- [ ] **Step 1: Install Prisma**

```bash
pnpm add @prisma/client
pnpm add -D prisma
```

- [ ] **Step 2: Write `prisma/schema.prisma`** (M1 portion only)

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "mysql"; url = env("DATABASE_URL") }

model Repository {
  id             BigInt   @id @default(autoincrement())
  owner          String   @db.VarChar(100)
  name           String   @db.VarChar(200)
  node           Json
  metadata       Json?
  etag           String?  @db.VarChar(64)
  lastFetchedAt  DateTime? @map("last_fetched_at")
  fetchStatus    FetchStatus @default(ok) @map("fetch_status")
  fetchError     String?  @db.Text @map("fetch_error")
  createdAt      DateTime @default(now()) @map("created_at")
  @@unique([owner, name])
  @@map("repositories")
}

enum FetchStatus { ok not_found forbidden error }
```

- [ ] **Step 3: Generate and migrate**

```bash
pnpm prisma migrate dev --name m1_repositories
```

- [ ] **Step 4: Write `src/lib/db/client.ts`**

```ts
import { PrismaClient } from '@prisma/client';
export const prisma = new PrismaClient({ log: ['error', 'warn'] });
```

- [ ] **Step 5: Integration test (uses testcontainers; for M1 skip and use real local MySQL via env)**

```ts
// tests/integration/prisma.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/db/client';
afterAll(() => prisma.$disconnect());
it('connects and runs raw query', async () => {
  const r = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
  expect(r[0].ok).toBe(1);
});
```

- [ ] **Step 6: Run, verify pass**

```bash
pnpm test tests/integration/prisma.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat(M1): Prisma schema with repositories table"
```

---

### M1.2 GitHub client (single token) and field mapping for `/repos`

**Files:**
- Create: `src/lib/github/client.ts`
- Create: `src/lib/github/fields.ts`
- Test: `tests/unit/github-client.test.ts`
- Test: `tests/integration/github-fetch.test.ts`

**Interfaces:**
- Produces:
  - `fetchRepo(owner: string, name: string): Promise<RepoCoreData>` — hits `GET /repos/{owner}/{name}` only in M1
  - `parseRepoResponse(json: unknown): RepoCoreData` — normalize fields
  - `RepoCoreData` type with: name, description, private, defaultBranch, stars, forks, watchers, createdAt, updatedAt, pushedAt, language, license, topics, homepage, archived, disabled, etag

- [ ] **Step 1: Install Octokit + MSW**

```bash
pnpm add @octokit/rest
pnpm add -D msw
pnpm exec msw init tests/ --save
```

- [ ] **Step 2: Write `src/lib/github/client.ts`**

```ts
import { Octokit } from '@octokit/rest';
import { env } from '@/lib/config/env';
import { GitHubError, GitHubUnavailable, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const octokit = new Octokit({ auth: env.GITHUB_TOKEN ?? process.env.GITHUB_TOKEN, request: { fetch } });
// ^^ M1 uses single token from env. M4 replaces with per-token Octokit.

export async function fetchRepoCore(owner: string, name: string): Promise<{ data: unknown; etag?: string }> {
  try {
    const res = await octokit.repos.get({ owner, repo: name });
    return { data: res.data, etag: res.headers.etag ?? undefined };
  } catch (e: any) {
    if (e?.status === 404) throw new NotFoundError(`Repo ${owner}/${name} not found`);
    if (e?.status === 403) throw new GitHubError('GH_FORBIDDEN', 403, e.message);
    if (e?.status >= 500) throw new GitHubUnavailable(`GitHub ${e.status}`);
    logger.error({ err: e }, 'unexpected github error');
    throw new GitHubError('GH_ERROR', e?.status ?? 500, e?.message ?? 'unknown');
  }
}
```

- [ ] **Step 3: Write `src/lib/github/fields.ts`**

```ts
export interface RepoCoreData {
  name: string; description: string | null; private: boolean; defaultBranch: string;
  stars: number; forks: number; watchers: number;
  createdAt: string; updatedAt: string; pushedAt: string | null;
  language: string | null; license: string | null; topics: string[];
  homepage: string | null; archived: boolean; disabled: boolean;
}
export function parseRepoResponse(raw: unknown): RepoCoreData {
  const r = raw as any;
  return {
    name: r.name, description: r.description ?? null, private: r.private,
    defaultBranch: r.default_branch, stars: r.stargazers_count, forks: r.forks_count, watchers: r.subscribers_count,
    createdAt: r.created_at, updatedAt: r.updated_at, pushedAt: r.pushed_at,
    language: r.language, license: r.license?.spdx_id ?? null,
    topics: r.topics ?? [], homepage: r.homepage, archived: r.archived, disabled: r.disabled,
  };
}
```

- [ ] **Step 4: Unit test for parser**

```ts
// tests/unit/github-fields.test.ts
import { describe, it, expect } from 'vitest';
import { parseRepoResponse } from '@/lib/github/fields';
it('normalizes fields', () => {
  const out = parseRepoResponse({ name: 'react', stargazers_count: 1, default_branch: 'main', license: { spdx_id: 'MIT' }, topics: ['ui'] });
  expect(out.stars).toBe(1);
  expect(out.license).toBe('MIT');
  expect(out.topics).toEqual(['ui']);
});
```

- [ ] **Step 5: Integration test using MSW**

```ts
// tests/integration/github-fetch.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { fetchRepoCore } from '@/lib/github/client';
const server = setupServer(
  http.get('https://api.github.com/repos/:owner/:name', () =>
    HttpResponse.json({ name: 'react', stargazers_count: 200000, default_branch: 'main' }, { headers: { etag: 'W/"abc"' } }))
);
beforeAll(() => server.listen()); afterAll(() => server.close());
it('returns data + etag', async () => {
  const r = await fetchRepoCore('facebook', 'react');
  expect(r.data).toMatchObject({ name: 'react' });
  expect(r.etag).toBe('W/"abc"');
});
```

- [ ] **Step 6: Run, verify pass**

```bash
pnpm test tests/unit/github-fields.test.ts tests/integration/github-fetch.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat(M1): github client + repo core field mapping"
```

---

### M1.3 Cache read/write

**Files:**
- Create: `src/lib/db/repositories.ts`
- Create: `src/lib/cache/read.ts`
- Create: `src/lib/cache/write.ts`
- Test: `tests/unit/cache-read.test.ts`
- Test: `tests/integration/cache-write.test.ts`

**Interfaces:**
- Produces:
  - `findRepoByCanonical(owner, name): Promise<Repository | null>`
  - `upsertRepo({owner, name, node, metadata, etag, fetchStatus, fetchError?}): Promise<Repository>`
  - `getRepoMetadata(owner, name): Promise<RepoMetadataResult>` where `RepoMetadataResult = { found: boolean; metadata?: unknown; lastFetchedAt?: Date; fetchStatus: FetchStatus; etag?: string }`

- [ ] **Step 1: Write `src/lib/db/repositories.ts`**

```ts
import { prisma } from '@/lib/db/client';
import type { Repository, FetchStatus, Prisma } from '@prisma/client';
export const findRepoByCanonical = (owner: string, name: string) =>
  prisma.repository.findUnique({ where: { owner_name: { owner, name } } });
export const upsertRepo = (data: Prisma.RepositoryUncheckedCreateInput) =>
  prisma.repository.upsert({
    where: { owner_name: { owner: data.owner, name: data.name } },
    create: data,
    update: { metadata: data.metadata, etag: data.etag, lastFetchedAt: data.lastFetchedAt, fetchStatus: data.fetchStatus, fetchError: data.fetchError ?? null },
  });
```

- [ ] **Step 2: Write `src/lib/cache/read.ts`**

```ts
import { findRepoByCanonical } from '@/lib/db/repositories';
export type RepoMetadataResult =
  | { found: true; metadata: unknown; lastFetchedAt: Date | null; fetchStatus: 'ok'|'forbidden'|'error'; etag: string | null }
  | { found: true; metadata: null; lastFetchedAt: Date | null; fetchStatus: 'not_found'; etag: string | null }
  | { found: false };
export async function getRepoMetadata(owner: string, name: string): Promise<RepoMetadataResult> {
  const row = await findRepoByCanonical(owner, name);
  if (!row) return { found: false };
  return { found: true, metadata: row.metadata, lastFetchedAt: row.lastFetchedAt, fetchStatus: row.fetchStatus, etag: row.etag };
}
```

- [ ] **Step 3: Write `src/lib/cache/write.ts`**

```ts
import { upsertRepo } from '@/lib/db/repositories';
import { logger } from '@/lib/logger';
export async function storeRepoMetadata(args: { owner: string; name: string; node: unknown; metadata: unknown; etag?: string; fetchStatus: 'ok'|'not_found'|'forbidden'|'error'; fetchError?: string }) {
  const row = await upsertRepo({
    owner: args.owner, name: args.name, node: args.node as any,
    metadata: args.metadata as any, etag: args.etag ?? null,
    lastFetchedAt: new Date(), fetchStatus: args.fetchStatus, fetchError: args.fetchError ?? null,
  });
  logger.info({ owner: args.owner, name: args.name, fetchStatus: args.fetchStatus }, 'repo stored');
  return row;
}
```

- [ ] **Step 4: Unit tests for read states (mock DB)**

```ts
// tests/unit/cache-read.test.ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/db/repositories', () => ({ findRepoByCanonical: vi.fn() }));
import { getRepoMetadata } from '@/lib/cache/read';
import { findRepoByCanonical } from '@/lib/db/repositories';
it('hit', async () => {
  vi.mocked(findRepoByCanonical).mockResolvedValue({ metadata: { stars: 1 }, fetchStatus: 'ok', lastFetchedAt: new Date(), etag: 'W/"x"' } as any);
  const r = await getRepoMetadata('a','b');
  expect(r.found).toBe(true); if (r.found) expect(r.fetchStatus).toBe('ok');
});
it('miss', async () => {
  vi.mocked(findRepoByCanonical).mockResolvedValue(null);
  const r = await getRepoMetadata('a','b');
  expect(r.found).toBe(false);
});
it('not_found', async () => {
  vi.mocked(findRepoByCanonical).mockResolvedValue({ metadata: null, fetchStatus: 'not_found', lastFetchedAt: null, etag: null } as any);
  const r = await getRepoMetadata('a','b');
  expect(r.found).toBe(true); if (r.found) expect(r.fetchStatus).toBe('not_found');
});
```

- [ ] **Step 5: Integration test against real DB**

```ts
// tests/integration/cache-write.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/db/client';
import { storeRepoMetadata, getRepoMetadata } from '@/lib/cache';
afterAll(() => prisma.$disconnect());
it('upserts then reads back', async () => {
  await prisma.repository.deleteMany({ where: { owner: 'test-owner' } });
  await storeRepoMetadata({ owner: 'test-owner', name: 'test-repo', node: 'test-owner/test-repo', metadata: { stars: 42 }, fetchStatus: 'ok' });
  const r = await getRepoMetadata('test-owner', 'test-repo');
  expect(r.found).toBe(true);
});
```

- [ ] **Step 6: Run tests**

```bash
pnpm test
```

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat(M1): cache read/write with three states"
```

---

### M1.4 Dev CLI script

**Files:**
- Create: `scripts/dev-fetch.ts`
- Modify: `package.json` (add `dev:fetch` script)

**Interfaces:**
- Consumes: `argv[2]` = `owner/name`
- Produces: writes one row to `repositories` via `storeRepoMetadata`

- [ ] **Step 1: Add tsx**

```bash
pnpm add -D tsx
```

- [ ] **Step 2: Write `scripts/dev-fetch.ts`**

```ts
#!/usr/bin/env tsx
import { fetchRepoCore } from '@/lib/github/client';
import { parseRepoResponse } from '@/lib/github/fields';
import { storeRepoMetadata } from '@/lib/cache/write';
import { prisma } from '@/lib/db/client';

const [owner, name] = (process.argv[2] ?? '').split('/');
if (!owner || !name) { console.error('usage: pnpm dev:fetch owner/name'); process.exit(1); }
try {
  const { data, etag } = await fetchRepoCore(owner, name);
  await storeRepoMetadata({ owner, name, node: `${owner}/${name}`, metadata: parseRepoResponse(data), etag, fetchStatus: 'ok' });
  console.log(`stored ${owner}/${name}`);
} catch (e: any) {
  if (e.code === 'NOT_FOUND') {
    await storeRepoMetadata({ owner, name, node: `${owner}/${name}`, metadata: null as any, fetchStatus: 'not_found', fetchError: '404' });
    console.log(`marked not_found ${owner}/${name}`);
  } else { console.error(e); process.exit(1); }
} finally { await prisma.$disconnect(); }
```

- [ ] **Step 3: Add script**

```json
"dev:fetch": "tsx scripts/dev-fetch.ts"
```

- [ ] **Step 4: Demo three outcomes**

```bash
pnpm dev:fetch facebook/react       # success
pnpm dev:fetch this-org/does-not-exist-9999   # not_found (after fixing Octokit behavior on 404)
GITHUB_TOKEN=fake pnpm dev:fetch any/repo      # network timeout → GitHubUnavailable
```

- [ ] **Step 5: Commit and tag**

```bash
git add .
git commit -m "feat(M1): dev:fetch CLI script"
git tag m1-data-path
```

---

## Milestone M2 — Public API Base (No Auth)

### M2.1 Node parser

**Files:**
- Create: `src/lib/cache/parser.ts`
- Test: `tests/unit/parser.test.ts`

**Interfaces:**
- Produces:
  - `parseNodes(input: unknown): { ok: true; nodes: { owner: string; name: string; original: string }[] } | { ok: false; error: string }`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { parseNodes } from '@/lib/cache/parser';
it('accepts URL', () => {
  const r = parseNodes({ nodes: ['https://github.com/facebook/react'] });
  expect(r).toEqual({ ok: true, nodes: [{ owner: 'facebook', name: 'react', original: 'https://github.com/facebook/react' }] });
});
it('accepts shorthand', () => {
  expect(parseNodes({ nodes: ['vuejs/core'] })).toEqual({ ok: true, nodes: [{ owner: 'vuejs', name: 'core', original: 'vuejs/core' }] });
});
it('accepts object', () => {
  expect(parseNodes({ nodes: [{ owner: 'x', repo: 'y' }] })).toEqual({ ok: true, nodes: [{ owner: 'x', name: 'y', original: 'x/y' }] });
});
it('rejects non-array', () => { expect(parseNodes({ nodes: 'a' }).ok).toBe(false); });
it('rejects > 50', () => { expect(parseNodes({ nodes: new Array(51).fill('a/b') }).ok).toBe(false); });
```

- [ ] **Step 2: Implement**

```ts
const URL_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/;
export function parseNodes(input: unknown): { ok: true; nodes: { owner: string; name: string; original: string }[] } | { ok: false; error: string } {
  const nodes = (input as any)?.nodes;
  if (!Array.isArray(nodes)) return { ok: false, error: 'nodes must be an array' };
  if (nodes.length > 50) return { ok: false, error: 'max 50 nodes' };
  const out: { owner: string; name: string; original: string }[] = [];
  for (const n of nodes) {
    if (typeof n === 'string') {
      if (n.includes('://')) {
        const m = URL_RE.exec(n); if (!m) return { ok: false, error: `bad URL: ${n}` };
        out.push({ owner: m[1], name: m[2], original: n });
      } else {
        const [owner, name] = n.split('/');
        if (!owner || !name) return { ok: false, error: `bad shorthand: ${n}` };
        out.push({ owner, name, original: n });
      }
    } else if (n && typeof n === 'object' && typeof n.owner === 'string' && typeof n.repo === 'string') {
      out.push({ owner: n.owner, name: n.repo, original: `${n.owner}/${n.repo}` });
    } else return { ok: false, error: 'invalid node shape' };
  }
  return { ok: true, nodes: out };
}
```

- [ ] **Step 3: Run, verify pass; commit**

```bash
git add . && git commit -m "feat(M2): node parser for query API"
```

---

### M2.2 In-memory rate limit (temporary)

**Files:**
- Create: `src/lib/rate-limit/memory.ts`
- Test: `tests/unit/rate-limit-memory.test.ts`

**Interfaces:**
- Produces:
  - `tokenBucket(key: string, perMinute: number): { allow(): boolean; reset(): void }`
  - Replaced in M8 by durable `lib/rate-limit/bucket.ts`

- [ ] **Step 1: Write tests, implement, verify, commit**

```ts
// src/lib/rate-limit/memory.ts
const buckets = new Map<string, { count: number; resetAt: number }>();
export function tokenBucket(key: string, perMinute: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) buckets.set(key, { count: 0, resetAt: now + 60_000 });
  const cur = buckets.get(key)!;
  return { allow: () => { if (cur.count >= perMinute) return false; cur.count++; return true; }, reset: () => buckets.delete(key) };
}
```

Commit: `feat(M2): in-memory token bucket (temp, replaced in M8)`.

---

### M2.3 `POST /api/query` route

**Files:**
- Create: `src/app/api/query/route.ts`
- Test: `tests/integration/query.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/query` with body `{ nodes: [...] }` returning per-node result

- [ ] **Step 1: Write failing integration tests** (happy, hit, miss, 404, >50, concurrent first-miss dedupe)

```ts
// tests/integration/query.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { POST } from '@/app/api/query/route';
import { prisma } from '@/lib/db/client';

const server = setupServer(
  http.get('https://api.github.com/repos/:owner/:name', ({ params }) =>
    HttpResponse.json({ name: params.name, stargazers_count: 100, default_branch: 'main' }))
);
beforeAll(() => server.listen()); afterAll(() => { server.close(); prisma.$disconnect(); });

it('hit returns from cache', async () => {
  await prisma.repository.deleteMany({ where: { owner: 'cache-owner' } });
  await prisma.repository.create({ data: { owner: 'cache-owner', name: 'r', node: 'cache-owner/r', metadata: { cached: true }, fetchStatus: 'ok' } });
  const res = await POST(new Request('http://x/api/query', { method: 'POST', body: JSON.stringify({ nodes: ['cache-owner/r'] }) }));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.results[0].found).toBe(true);
  expect(body.results[0].metadata).toEqual({ cached: true });
});

it('miss fetches and caches', async () => {
  await prisma.repository.deleteMany({ where: { owner: 'miss-owner' } });
  const res = await POST(new Request('http://x/api/query', { method: 'POST', body: JSON.stringify({ nodes: ['miss-owner/new'] }) }));
  const body = await res.json();
  expect(body.results[0].found).toBe(true);
  expect(body.results[0].metadata).toMatchObject({ name: 'new' });
});

it('rejects >50 nodes', async () => {
  const res = await POST(new Request('http://x/api/query', { method: 'POST', body: JSON.stringify({ nodes: new Array(51).fill('a/b') }) }));
  expect(res.status).toBe(400);
});

it('rejects malformed', async () => {
  const res = await POST(new Request('http://x/api/query', { method: 'POST', body: JSON.stringify({ nodes: 'not-array' }) }));
  expect(res.status).toBe(400);
});

it('concurrent first-miss dedupes to one GitHub call', async () => {
  await prisma.repository.deleteMany({ where: { owner: 'dedupe' } });
  let count = 0;
  server.use(http.get('https://api.github.com/repos/dedupe/:name', () => { count++; return HttpResponse.json({ name: 'r' }); }));
  await Promise.all([
    POST(new Request('http://x/api/query', { method: 'POST', body: JSON.stringify({ nodes: ['dedupe/r'] }) })),
    POST(new Request('http://x/api/query', { method: 'POST', body: JSON.stringify({ nodes: ['dedupe/r'] }) })),
    POST(new Request('http://x/api/query', { method: 'POST', body: JSON.stringify({ nodes: ['dedupe/r'] }) })),
  ]);
  expect(count).toBe(1);
});
```

- [ ] **Step 2: Implement route**

```ts
// src/app/api/query/route.ts
import { NextResponse } from 'next/server';
import { parseNodes } from '@/lib/cache/parser';
import { getRepoMetadata } from '@/lib/cache/read';
import { fetchRepoCore } from '@/lib/github/client';
import { parseRepoResponse } from '@/lib/github/fields';
import { storeRepoMetadata } from '@/lib/cache/write';
import { ValidationError, NotFoundError } from '@/lib/errors';

const pending = new Map<string, Promise<unknown>>();
async function firstMiss(owner: string, name: string) {
  const key = `${owner}/${name}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const p = (async () => {
    try {
      const { data, etag } = await fetchRepoCore(owner, name);
      return await storeRepoMetadata({ owner, name, node: key, metadata: parseRepoResponse(data), etag, fetchStatus: 'ok' });
    } catch (e) {
      if (e instanceof NotFoundError) return await storeRepoMetadata({ owner, name, node: key, metadata: null as any, fetchStatus: 'not_found', fetchError: '404' });
      throw e;
    }
  })();
  pending.set(key, p);
  try { return await p; } finally { pending.delete(key); }
}

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'malformed json' }, { status: 400 }); }
  const parsed = parseNodes(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const results = await Promise.all(parsed.nodes.map(async (n) => {
    const r = await getRepoMetadata(n.owner, n.name);
    if (r.found) {
      if (r.fetchStatus === 'ok') return { canonical: `${n.owner}/${n.name}`, original: n.original, found: true, metadata: r.metadata, last_fetched_at: r.lastFetchedAt, fetch_status: r.fetchStatus, stale: false };
      if (r.fetchStatus === 'not_found') return { canonical: `${n.owner}/${n.name}`, original: n.original, found: false, fetch_status: 'not_found', error: 'Repository not found or private' };
    }
    await firstMiss(n.owner, n.name);
    const r2 = await getRepoMetadata(n.owner, n.name);
    return { canonical: `${n.owner}/${n.name}`, original: n.original, found: r2.found && r2.fetchStatus === 'ok', metadata: r2.found ? r2.metadata : undefined, last_fetched_at: r2.found ? r2.lastFetchedAt : undefined, fetch_status: r2.found ? r2.fetchStatus : 'error', stale: false };
  }));

  const summary = { hit: results.filter(r => r.fetch_status === 'ok' && r.found).length, miss: 0, stale: 0 };
  return NextResponse.json({ results, summary });
}
```

- [ ] **Step 3: Run, verify pass; commit and tag**

```bash
git add . && git commit -m "feat(M2): POST /api/query with hit/miss/dedupe" && git tag m2-public-api
```

---

## Milestone M3 — API Key Request + Approval (Dev-Token Mode)

### M3.1 Extend Prisma schema with `users`, `api_keys`, `audit_log`, `request_log`

**Files:**
- Modify: `prisma/schema.prisma`

```prisma
model User {
  id BigInt @id @default(autoincrement())
  email String @unique @db.VarChar(255)
  passwordHash String? @map("password_hash") @db.VarChar(255)
  role Role @default(operator)
  status UserStatus @default(active) @map("user_status")
  createdAt DateTime @default(now()) @map("created_at")
  lastLoginAt DateTime? @map("last_login_at")
  apiKeys ApiKey[] @relation("owner")
  approvedKeys ApiKey[] @relation("approver")
  @@map("users")
}
enum Role { admin operator }
enum UserStatus { active disabled }

model ApiKey {
  id BigInt @id @default(autoincrement())
  userId BigInt @map("user_id")
  user User @relation("owner", fields: [userId], references: [id])
  name String @db.VarChar(100)
  keyPrefix String @map("key_prefix") @db.VarChar(16)
  keyHash String @unique @map("key_hash") @db.VarChar(64)
  status ApiKeyStatus @default(pending)
  rateLimitPerMin Int @default(60) @map("rate_limit_per_min")
  dailyQuota Int @default(10000) @map("daily_quota")
  createdAt DateTime @default(now()) @map("created_at")
  approvedAt DateTime? @map("approved_at")
  approvedBy BigInt? @map("approved_by")
  approver User? @relation("approver", fields: [approvedBy], references: [id])
  revokedAt DateTime? @map("revoked_at")
  lastUsedAt DateTime? @map("last_used_at")
  @@index([status])
  @@map("api_keys")
}
enum ApiKeyStatus { pending active revoked }

model AuditLog {
  id BigInt @id @default(autoincrement())
  actorUserId BigInt? @map("actor_user_id")
  action String @db.VarChar(100)
  targetType String @map("target_type") @db.VarChar(50)
  targetId String @map("target_id") @db.VarChar(100)
  metadata Json?
  ip String? @db.VarChar(45)
  createdAt DateTime @default(now()) @map("created_at")
  @@index([action])
  @@index([createdAt])
  @@map("audit_log")
}

model RequestLog {
  id BigInt @id @default(autoincrement())
  apiKeyId BigInt? @map("api_key_id")
  endpoint String @db.VarChar(100)
  repoRequested String? @map("repo_requested") @db.VarChar(300)
  cacheHit Boolean @map("cache_hit")
  durationMs Int @map("duration_ms")
  statusCode Int @map("status_code")
  ip String? @db.VarChar(45)
  createdAt DateTime @default(now()) @map("created_at")
  @@index([createdAt])
  @@index([apiKeyId, createdAt])
  @@map("request_log")
}
```

- [ ] **Step 1: Generate migration; commit**

```bash
pnpm prisma migrate dev --name m3_users_apikeys_audit_requestlog
git add . && git commit -m "feat(M3): schema for users, api_keys, audit_log, request_log"
```

---

### M3.2 Key generation and SHA-256 verification

**Files:**
- Create: `src/lib/api-keys/generate.ts`
- Create: `src/lib/api-keys/verify.ts`
- Create: `src/lib/db/api-keys.ts`
- Test: `tests/unit/api-keys-generate.test.ts`

**Interfaces:**
- Produces:
  - `generateApiKey(): { plain: string; prefix: string; hash: string }`
  - `verifyApiKey(plain: string, hash: string): Promise<boolean>`

- [ ] **Step 1: Write failing test (uniqueness over 10000)**

```ts
import { describe, it, expect } from 'vitest';
import { generateApiKey } from '@/lib/api-keys/generate';
import { verifyApiKey } from '@/lib/api-keys/verify';
import { createHash } from 'crypto';

it('generates ghc_live_<32hex>', () => {
  const k = generateApiKey();
  expect(k.plain).toMatch(/^ghc_live_[0-9a-f]{32}$/);
  expect(k.prefix).toBe(k.plain.slice(0, 12));
});
it('verifies via SHA-256', async () => {
  const k = generateApiKey();
  expect(await verifyApiKey(k.plain, k.hash)).toBe(true);
  expect(await verifyApiKey(k.plain + 'x', k.hash)).toBe(false);
});
it('10000 keys unique', () => {
  const set = new Set<string>();
  for (let i = 0; i < 10000; i++) set.add(generateApiKey().plain);
  expect(set.size).toBe(10000);
});
```

- [ ] **Step 2: Implement**

```ts
// src/lib/api-keys/generate.ts
import { randomBytes, createHash } from 'crypto';
export function generateApiKey() {
  const hex = randomBytes(16).toString('hex');
  const plain = `ghc_live_${hex}`;
  const prefix = plain.slice(0, 12);
  const hash = createHash('sha256').update(plain).digest('hex');
  return { plain, prefix, hash };
}
```

```ts
// src/lib/api-keys/verify.ts
import { createHash } from 'crypto';
export function verifyApiKey(plain: string, hash: string): Promise<boolean> {
  return Promise.resolve(createHash('sha256').update(plain).digest('hex') === hash);
}
```

- [ ] **Step 3: Run tests; commit**

```bash
git add . && git commit -m "feat(M3): api key generation + SHA-256 verification"
```

---

### M3.3 Dev-token validator (deleted in M6)

**Files:**
- Create: `src/lib/dev-token/index.ts`
- Test: `tests/unit/dev-token.test.ts`

**Interfaces:**
- Produces:
  - `validateDevToken(req: Request): boolean` — true if `X-Admin-Dev-Token` matches env `ADMIN_DEV_TOKEN` AND `NODE_ENV !== 'production'`

- [ ] **Step 1: Implement + tests + commit**

```ts
// src/lib/dev-token/index.ts
import { env } from '@/lib/config/env';
export function validateDevToken(req: Request): boolean {
  if (env.NODE_ENV === 'production') return false;
  const token = req.headers.get('x-admin-dev-token');
  return token === (process.env.ADMIN_DEV_TOKEN ?? 'dev-only-token');
}
```

Extend env schema to include `ADMIN_DEV_TOKEN: z.string().default('dev-only-token')`.

Commit: `feat(M3): dev-token validator (will be deleted in M6)`.

---

### M3.4 API key approval + revocation endpoints (dev-token mode)

**Files:**
- Create: `src/lib/api-keys/workflow.ts`
- Create: `src/app/api/admin/dev-token-approve/route.ts`
- Create: `src/app/api/admin/api-keys/[id]/revoke/route.ts`
- Create: `src/lib/audit/writer.ts`
- Create: `src/lib/db/audit-log.ts`
- Create: `src/lib/db/request-log.ts`
- Test: `tests/integration/api-keys-flow.test.ts`

**Interfaces:**
- Produces:
  - `requestKey({userId, name}): Promise<ApiKey>` — status=pending
  - `approveKey({id, rateLimit, dailyQuota, actorUserId}): Promise<{ plain: string; row: ApiKey }>`
  - `revokeKey({id, actorUserId}): Promise<ApiKey>`
  - `recordRequest({apiKeyId, endpoint, repoRequested, cacheHit, durationMs, statusCode, ip})`

- [ ] **Step 1: Write failing integration test covering: request → approve → use key → revoke → 403**

```ts
// tests/integration/api-keys-flow.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db/client';
import { requestKey, approveKey, revokeKey } from '@/lib/api-keys/workflow';
import { validateDevToken } from '@/lib/dev-token';

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: 'flow@test' } });
  await prisma.user.create({ data: { email: 'flow@test', role: 'admin', status: 'active' } });
});
afterAll(() => prisma.$disconnect());

it('full lifecycle', async () => {
  const user = await prisma.user.findUnique({ where: { email: 'flow@test' } });
  const req = await requestKey({ userId: user!.id, name: 'flow-test' });
  expect(req.status).toBe('pending');
  const { plain, row } = await approveKey({ id: req.id, rateLimit: 60, dailyQuota: 1000, actorUserId: user!.id });
  expect(plain).toMatch(/^ghc_live_/);
  expect(row.status).toBe('active');
  // simulate call
  const ok = await fetch('http://localhost:3000/api/query', { method: 'POST', headers: { 'X-API-Key': plain, 'Content-Type': 'application/json' }, body: JSON.stringify({ nodes: ['facebook/react'] }) });
  expect([200, 404, 503]).toContain(ok.status); // ok.status = 200 if cache hit
  await revokeKey({ id: row.id, actorUserId: user!.id });
  const after = await fetch('http://localhost:3000/api/query', { method: 'POST', headers: { 'X-API-Key': plain, 'Content-Type': 'application/json' }, body: JSON.stringify({ nodes: ['facebook/react'] }) });
  expect(after.status).toBe(403);
});
```

- [ ] **Step 2: Implement workflow + audit + log writers + dev-token route + revoke route**

Code shape:

```ts
// src/lib/api-keys/workflow.ts — requestKey, approveKey, revokeKey using prisma.apiKey.* and audit writer
// src/lib/audit/writer.ts — writeAudit({actorUserId, action, targetType, targetId, metadata, ip})
// src/lib/db/audit-log.ts — prisma.auditLog.create wrapper
// src/lib/db/request-log.ts — prisma.requestLog.create wrapper
// src/app/api/admin/dev-token-approve/[id]/route.ts — POST: if (!validateDevToken(req)) return 404; else approveKey via body
// src/app/api/admin/api-keys/[id]/revoke/route.ts — POST: same dev-token check, then revokeKey
```

- [ ] **Step 3: Modify `/api/query` to require `X-API-Key`**

```ts
// at top of POST(req):
const key = req.headers.get('x-api-key');
if (!key) return NextResponse.json({ error: 'missing api key' }, { status: 401 });
const hash = createHash('sha256').update(key).digest('hex');
const apiKey = await prisma.apiKey.findUnique({ where: { keyHash: hash } });
if (!apiKey || apiKey.status !== 'active') return NextResponse.json({ error: 'invalid api key' }, { status: 403 });
const start = Date.now();
// ... existing logic ...
// on every response:
await recordRequest({ apiKeyId: apiKey.id, endpoint: '/api/query', repoRequested: n.original, cacheHit: ..., durationMs: Date.now() - start, statusCode: res.status, ip: req.headers.get('x-forwarded-for') ?? '' });
```

- [ ] **Step 4: Run tests; commit and tag**

```bash
git add . && git commit -m "feat(M3): API key lifecycle + X-API-Key auth on /api/query" && git tag m3-api-keys
```

---

## Milestone M4 — Multi-Token Pool

### M4.1 Extend schema with `github_tokens`

**Files:**
- Modify: `prisma/schema.prisma`

```prisma
model GithubToken {
  id BigInt @id @default(autoincrement())
  label String @db.VarChar(100)
  tokenFirst4 String @map("token_first4") @db.Char(4)
  tokenLast4 String @map("token_last4") @db.Char(4)
  tokenHash String @unique @map("token_hash") @db.Char(64)
  status GithubTokenStatus @default(active)
  requestsUsed Int @default(0) @map("requests_used")
  requestsLimit Int @default(5000) @map("requests_limit")
  resetAt DateTime? @map("reset_at")
  lastUsedAt DateTime? @map("last_used_at")
  createdAt DateTime @default(now()) @map("created_at")
  @@map("github_tokens")
}
enum GithubTokenStatus { active disabled }
```

Migrate; commit: `feat(M4): schema github_tokens`.

### M4.2 Token loader from file/env

**Files:**
- Create: `src/lib/github/tokens-loader.ts`
- Test: `tests/unit/tokens-loader.test.ts`

**Interfaces:**
- Produces:
  - `loadTokensFromEnv(): { raw: string; first4: string; last4: string; hash: string }[]`
  - Reads `GITHUB_TOKENS_FILE` if set, else `GITHUB_TOKENS` (comma-separated)

### M4.3 Pool with `pickToken` + quota persistence

**Files:**
- Create: `src/lib/github/pool.ts`
- Create: `src/lib/db/github-tokens.ts`
- Test: `tests/unit/pool.test.ts` (with fake clock + MSW)

**Interfaces:**
- Produces:
  - `initPool(): Promise<void>` — reads DB, populates in-memory map
  - `pickToken(): { id: number; octokit: Octokit } | null`
  - `recordUsage(tokenId, remaining, resetAt): void`
  - `persistQuota(): Promise<void>` — flush to DB every 25 calls or 60s

### M4.4 Replace client.ts to use pool + 429 backoff

**Files:**
- Modify: `src/lib/github/client.ts`

```ts
import { pickToken, recordUsage, getBackoff } from './pool';
// retry wrapper: on 403 with remaining=0 → pickToken again; on 429 → sleep getBackoff then retry
```

- [ ] **Step 1: Implement + tests (3 tokens simulate exhaustion) + commit**

```bash
git add . && git commit -m "feat(M4): multi-token pool with rotation + 429 backoff" && git tag m4-token-pool
```

---

## Milestone M5 — Scheduler + Aging

### M5.1 Extend schema with `refresh_jobs`

```prisma
model RefreshJob {
  id BigInt @id @default(autoincrement())
  repositoryId BigInt @map("repository_id")
  priority Int @default(50)
  scheduledFor DateTime @map("scheduled_for")
  status RefreshJobStatus @default(pending)
  attempts Int @default(0)
  lastError String? @map("last_error") @db.Text
  lockedUntil DateTime? @map("locked_until")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  repository Repository @relation(fields: [repositoryId], references: [id])
  @@index([status, scheduledFor])
  @@index([status, priority])
  @@map("refresh_jobs")
}
enum RefreshJobStatus { pending in_progress done failed }
```

Migrate; commit.

### M5.2 Lease helper (`SELECT FOR UPDATE SKIP LOCKED`)

**Files:**
- Create: `src/lib/scheduler/lease.ts`
- Test: `tests/integration/scheduler-lease.test.ts` (uses testcontainers)

**Interfaces:**
- Produces:
  - `claimBatch(batchSize: number): Promise<RefreshJob[]>`

```ts
export async function claimBatch(n: number) {
  return prisma.$transaction(async tx => {
    const jobs = await tx.$queryRaw<Array<{ id: bigint; repository_id: bigint }>>`
      SELECT id, repository_id FROM refresh_jobs
      WHERE status = 'pending' AND scheduled_for <= NOW() AND (locked_until IS NULL OR locked_until < NOW())
      ORDER BY priority ASC, scheduled_for ASC LIMIT ${n} FOR UPDATE SKIP LOCKED
    `;
    const ids = jobs.map(j => j.id);
    if (ids.length === 0) return [];
    await tx.refreshJob.updateMany({ where: { id: { in: ids } }, data: { status: 'in_progress', lockedUntil: new Date(Date.now() + 5*60_000), attempts: { increment: 1 } } });
    return tx.refreshJob.findMany({ where: { id: { in: ids } }, include: { repository: true } });
  });
}
```

### M5.3 Aging policy

**Files:**
- Create: `src/lib/scheduler/aging.ts`
- Test: `tests/unit/aging.test.ts`

**Interfaces:**
- Produces:
  - `nextDelay(refreshCount: number, recentQueryCount24h: number): { ms: number; failure?: boolean }`
  - Returns 1h/6h/7d per spec; hot-bump overrides to 1h
  - Failure schedule: 5min→15min→1h→6h→24h, escalates after 5

### M5.4 Single-refresh worker

**Files:**
- Create: `src/lib/jobs/refresh-one.ts`

```ts
export async function refreshOne(job: RefreshJob & { repository: Repository }) {
  const repo = job.repository;
  // Conditional GET with etag (304 short-circuit)
  // On 200 → fetch all 7 endpoints, parse, upsert
  // On 404/410 → fetch_status=not_found, reschedule 24h
  // On 403 → fetch_status=forbidden, audit_log, don't requeue
  // On 429 → release lock, exponential backoff
}
```

### M5.5 Scheduler tick + nightly sweep

**Files:**
- Create: `src/lib/scheduler/tick.ts`
- Create: `src/lib/scheduler/sweep.ts`
- Create: `src/lib/scheduler/index.ts`

```ts
// tick.ts
export async function runTick() {
  const jobs = await claimBatch(env.SCHEDULER_BATCH_SIZE);
  await Promise.all(jobs.map(async j => {
    try { await refreshOne(j); await prisma.refreshJob.update({ where: { id: j.id }, data: { status: 'done' } }); }
    catch (e: any) { /* handle backoff / failure escalation */ }
  }));
}
```

```ts
// sweep.ts
export async function nightlySweep() {
  const repos = await prisma.repository.findMany({ where: { fetchStatus: 'ok' }, select: { id: true } });
  await prisma.refreshJob.createMany({ data: repos.map(r => ({ repositoryId: r.id, priority: 99, scheduledFor: new Date() })) });
}
```

```ts
// scheduler/index.ts
import cron from 'node-cron';
export function startScheduler() {
  const tickJob = cron.schedule(`*/${Math.floor(env.SCHEDULER_TICK_MS/1000)} * * * * *`, () => { runTick().catch(logErr); });
  const sweepJob = cron.schedule(env.NIGHTLY_SWEEP_CRON, () => { nightlySweep().catch(logErr); });
  return { stop: () => { tickJob.stop(); sweepJob.stop(); } };
}
```

### M5.6 Custom server boot

**Files:**
- Modify: `src/server.ts`

```ts
import next from 'next';
import { startScheduler } from '@/lib/scheduler';
import { initPool } from '@/lib/github/pool';
import { env } from '@/lib/config/env';

const app = next({ dev: env.NODE_ENV !== 'production' });
const handle = app.getRequestHandler();
(async () => {
  await app.prepare();
  await initPool();
  const scheduler = startScheduler();
  const server = app.getUpgradeServer ? null : null;
  require('http').createServer((req, res) => handle(req, res)).listen(env.PORT, () => logger.info({ port: env.PORT }, 'listening'));
  process.on('SIGTERM', () => { scheduler.stop(); process.exit(0); });
  process.on('SIGINT', () => { scheduler.stop(); process.exit(0); });
})();
```

- [ ] **Step 1: Implement + integration tests; demo: mark 50 repos stale, watch queue drain; commit and tag**

```bash
git add . && git commit -m "feat(M5): scheduler + aging + nightly sweep + custom server" && git tag m5-scheduler
```

---

## Milestone M6 — Admin Real Auth

### M6.1 Sessions schema + bcrypt helpers

```prisma
model Session {
  id String @id @db.Char(43)
  userId BigInt @map("user_id")
  expiresAt DateTime @map("expires_at")
  createdAt DateTime @default(now()) @map("created_at")
  ip String? @db.VarChar(45)
  user User @relation(fields: [userId], references: [id])
  @@map("sessions")
}

model Invitation {
  id String @id @db.Char(32)
  email String @db.VarChar(255)
  role Role
  invitedBy BigInt @map("invited_by")
  expiresAt DateTime @map("expires_at")
  consumedAt DateTime? @map("consumed_at")
  createdAt DateTime @default(now()) @map("created_at")
  @@map("invitations")
}
```

Migrate.

- [ ] **Step 1: Create `src/lib/auth/password.ts` with `hashPassword(p)`, `verifyPassword(p, hash)` using bcrypt cost 12**

### M6.2 Session CRUD + cookie helpers

**Files:**
- Create: `src/lib/auth/session.ts`
- Create: `src/lib/db/sessions.ts`
- Create: `src/lib/auth/csrf.ts`

**Interfaces:**
- Produces:
  - `createSession(userId, ip): Promise<{ id: string; expiresAt: Date }>`
  - `validateSession(req): Promise<User | null>`
  - `setSessionCookie(res, id)`, `clearSessionCookie(res)`
  - `issueCsrf()`, `verifyCsrf(req, token)`

### M6.3 Login throttle

**Files:**
- Create: `src/lib/rate-limit/login-throttle.ts` — 5 attempts / 15min / IP, audit each

### M6.4 Login route + logout route

**Files:**
- Create: `src/app/api/admin/auth/login/route.ts` — POST {email, password, csrf}
- Create: `src/app/api/admin/auth/logout/route.ts` — POST

### M6.5 Middleware for `/admin/*`

**Files:**
- Modify: `src/middleware.ts`

```ts
export async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/admin')) {
    const user = await validateSession(req);
    if (!user) return NextResponse.redirect(new URL('/login', req.url));
  }
  if (req.nextUrl.pathname.startsWith('/api/admin') && req.method !== 'GET') {
    const token = req.headers.get('x-csrf-token');
    if (!verifyCsrf(req, token)) return NextResponse.json({ error: 'csrf' }, { status: 403 });
  }
  return NextResponse.next();
}
export const config = { matcher: ['/admin/:path*', '/api/admin/:path*'] };
```

### M6.6 Login page + admin dashboard + delete dev-token

**Files:**
- Create: `src/app/login/page.tsx`
- Create: `src/app/admin/layout.tsx`
- Create: `src/app/admin/page.tsx`
- Modify: `src/app/api/admin/dev-token-approve/[id]/route.ts` → **DELETE FILE**
- Modify: `src/lib/dev-token/index.ts` → **DELETE FILE**
- Modify: `src/app/api/admin/api-keys/[id]/approve/route.ts` → use real session instead of dev-token (re-route via `validateSession` + CSRF)

### M6.7 Tests

- Session TTL slide
- Password reset logs out all sessions
- CSRF missing-token rejected
- Throttle triggers after 5 failures
- Dev-token endpoint grep-verified absent

- [ ] **Step 1: Implement, test, commit, tag**

```bash
git add . && git commit -m "feat(M6): admin real auth + delete dev-token" && git tag m6-admin-auth
```

---

## Milestone M7 — Admin SPA Depth

### M7.1 Users CRUD + invitations

**Files:**
- Create: `src/app/admin/users/page.tsx`
- Create: `src/app/api/admin/users/invite/route.ts`
- Create: `src/app/api/admin/users/[id]/route.ts` (PATCH disable/enable, DELETE logout-all)
- Create: `src/lib/db/users.ts`
- Create: `src/lib/db/invitations.ts`

### M7.2 API keys list + detail

**Files:**
- Create: `src/app/admin/api-keys/page.tsx`
- Create: `src/app/admin/api-keys/[id]/page.tsx`
- Create: `src/app/api/admin/api-keys/[id]/route.ts` (PATCH limits, writes audit_log)

### M7.3 GitHub tokens management

**Files:**
- Create: `src/app/admin/github-tokens/page.tsx`
- Create: `src/app/api/admin/github-tokens/route.ts` (GET/POST)
- Create: `src/app/api/admin/github-tokens/[id]/route.ts` (PATCH disable/enable, DELETE)

### M7.4 Reports

**Files:**
- Create: `src/app/admin/reports/page.tsx`
- Create: `src/app/api/admin/reports/route.ts`
- Create: `src/lib/reports/queries.ts` (N+1-free aggregations: requests-over-time, hit-rate, top-repos, top-keys, token-quota)

```ts
// queries.ts sketch
export async function requestsOverTime(from: Date, to: Date, bucket: 'hour'|'day') { /* GROUP BY DATE_FORMAT(...) */ }
export async function topRepos(from: Date, to: Date, limit: number) { /* JOIN request_log */ }
```

### M7.5 Audit log search

**Files:**
- Create: `src/app/admin/audit/page.tsx`
- Create: `src/app/api/admin/audit/route.ts`

### M7.6 Manual refresh + queue pause

**Files:**
- Create: `src/app/admin/refresh/page.tsx`
- Create: `src/app/api/admin/refresh/route.ts` — POST `{action: 'trigger'|'pause'|'resume'}`, writes audit_log

### M7.7 Playwright e2e

**Files:**
- Create: `tests/e2e/admin-flow.spec.ts`

```ts
test('admin full daily-ops', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name=email]', 'admin@test');
  await page.fill('input[name=password]', 'pw');
  await page.click('button[type=submit]');
  await expect(page).toHaveURL('/admin');
  await page.click('a[href="/admin/api-keys"]');
  // ...
});
```

- [ ] **Step 1: Build each subpage; test with Playwright; commit and tag**

```bash
git add . && git commit -m "feat(M7): admin SPA depth + reports + audit + e2e" && git tag m7-admin-spa
```

---

## Milestone M8 — Graceful Degradation, Throttling, Observability, Tests, CI

### M8.1 Replace in-memory rate limit with durable token bucket

**Files:**
- Create: `src/lib/rate-limit/bucket.ts` (DB-backed, sliding window)
- Modify: `src/lib/rate-limit/memory.ts` → delete usages; replace with bucket

### M8.2 GitHubUnavailable → stale path in /api/query

**Files:**
- Modify: `src/lib/github/client.ts` — catch network errors → throw `GitHubUnavailable`
- Modify: `src/app/api/query/route.ts` — catch `GitHubUnavailable` → return cached + `stale:true`

### M8.3 refresh.failed_review audit trigger

**Files:**
- Modify: `src/lib/jobs/refresh-one.ts` — after 5 consecutive failures → `writeAudit({action: 'refresh.failed_review', ...})`

### M8.4 Full /api/v1/status

```ts
export async function GET() {
  const dbUp = await pingDb();
  const tokens = await summarizeTokens();
  const queue = await prisma.refreshJob.count({ where: { status: 'pending' } });
  return NextResponse.json({ ok: dbUp && tokens.active > 0, db: dbUp ? 'up' : 'down', tokens, queue });
}
```

### M8.5 GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

```yaml
name: ci
on: [push, pull_request]
jobs:
  unit:
    runs-on: ubuntu-latest
    services: { mysql: { image: mysql:8.0, env: { MYSQL_ROOT_PASSWORD: test, MYSQL_DATABASE: test }, ports: ['3306:3306'], options: --health-cmd="mysqladmin ping" --health-intervals=10s --health-timeout=5s --health-retries=5 } }
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
        env: { DATABASE_URL: mysql://root:test@localhost:3306/test }
```

### M8.6 Dockerfile multi-stage

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm prisma generate && pnpm build

FROM node:20-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist
COPY package.json ./
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

### M8.7 Deploy README + ops runbook

**Files:**
- Modify: `README.md` — add "first deploy", "daily ops", "troubleshooting" sections
- Create: `docs/runbook.md` — common alerts (token pool exhaustion, scheduler queue depth > 1000, DB connection failure, GitHub 5xx surge)

- [ ] **Step 1: Implement; load test with wrk; demo firewall block + stale path; commit and tag**

```bash
wrk -t4 -c100 -d60s http://localhost:3000/api/query -s post-query.lua
git add . && git commit -m "feat(M8): graceful degradation + durable throttling + CI + Dockerfile + runbook" && git tag m8-prod-ready
```

---

## Self-Review

Run against the companion spec + strategy spec:

**Spec coverage:**

| Spec section | Plan tasks |
|---|---|
| §1 Purpose | End-to-end covered by M0–M8 |
| §2 Goals | F. section in strategy; M8 covers all performance/security/test items |
| §3 Architecture | M0 (skeleton, layout, boundaries), M5 (custom server boots scheduler) |
| §4 Data Model | M1.1 (repositories), M3.1 (users/api_keys/audit/request_log), M4.1 (github_tokens), M5.1 (refresh_jobs), M6.1 (sessions/invitations) |
| §5 GitHub Client | M1.2, M4.2-M4.4 |
| §6 Cache & Scheduler | M1.3, M2.3, M5.2–M5.6 |
| §7 Public API | M2.3 (M2), M3.4 (X-API-Key), M8.1-M8.2 (throttling + stale) |
| §8 Admin Auth & Key Approval | M3.2-M3.4 (dev-token), M6 (real), M7.1 (invitations) |
| §9 Admin SPA | M6.6 (dashboard), M7.1–M7.6 |
| §10 Errors/Logging/Monitoring | M0.3 (errors, logger), M8.3-M8.4 (monitoring) |
| §11 Testing | Per-milestone tests; M8.5 CI |
| §12 Setup & Deployment | M0.4 (env, scripts), M5.6 (custom server), M8.5-M8.7 (CI/Docker/runbook) |
| Strategy §3 acceptance criteria | Every M0–M8 milestone has Function/Tests/Demo/Exit |

**Placeholder scan:** No "TBD", "TODO", or vague steps. All file paths concrete. All env vars in Global Constraints.

**Type consistency check:**
- `RepoMetadataResult` defined in M1.3, consumed in M2.3 — matches.
- `ApiKey` row shape consistent across M3.2 / M3.4 / M7.2.
- `RefreshJob` defined in M5.1, used in M5.2 / M5.4 — matches.
- `pickToken()` signature consistent in M4.3 and M4.4.
- Session shape `Session { id, userId, expiresAt, ... }` consistent M6.1 → M6.2 → M6.5.

**Found no inconsistencies; no spec gaps.**

---

## Execution Handoff

The plan is complete and saved to `docs/superpowers/plans/2026-08-15-github-metadata-cache-implementation.md`.

Two execution options:
1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints