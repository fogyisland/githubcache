# Admin 连接层统一化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 admin 后台的连接层重复实现收敛到现有 helper + 新增薄包装：admin page session 校验、admin route handler 认证、admin mutating fetch 封装，并产出数据获取规则文档。

**Architecture:** 三步独立 commit，每步独立 revert。所有改动都是「删复制粘贴 + 加 import + 加薄包装」，零行为变更。

**Tech Stack:** Next.js 15 (App Router) + React 19 + TypeScript + Zod + next-intl + Prisma 5 + Vitest

**Spec:** `docs/superpowers/specs/2026-09-09-admin-connection-unification-design.md`

---

## 全局约束

- **零行为变更**。所有改动都是结构重构，不引入新功能。
- **三步独立 commit**，每步完成后必须 `npm run typecheck && npm run lint && npm test` 全绿才进入下一步。
- **不动的文件**:
  - `src/app/admin/layout.tsx`（保留第二层 session 守卫）
  - `src/lib/auth/{csrf,session}.ts`（已用）
  - `src/lib/csrf/client.ts`（已实现，Step 3 直接复用）
  - `src/lib/api/{errors,request-id}.ts`（server-side，新代码不涉及）
  - `src/lib/admin/{status-loader,dashboard-buckets}.ts`（已正确抽象）
  - `src/app/admin/database/{page,schema/page,operations/page}.tsx`（已用 `requireAdmin()`）
- **Pre-existing 失败**（CLAUDE.md 提到 ~6 个 vitest 失败）：不修，不是本计划回归。
- **Plan 范围外但已发现的事实**：除 `users/[id]/route.ts` 外，其余 25 个 `/api/admin/*` mutating route handler 完全没有 role check（operator 可调所有非 GET endpoint）。本计划**只动 users/[id]/route.ts**；补全其他 route 的 role check 写独立 spec。

---

## Task 0: 准备工作

**Files:**
- 不改任何文件

**步骤**:

- [ ] **Step 0.1: 确认当前 git 工作树干净**

Run: `git status`
Expected: 无未提交改动（或只有 docs/ 改动）。

- [ ] **Step 0.2: 确认 spec 已 commit**

Run: `git log --oneline -1 docs/superpowers/specs/2026-09-09-admin-connection-unification-design.md`
Expected: 返回 commit hash。

- [ ] **Step 0.3: 跑 baseline 三门**

Run: `npm run typecheck && npm run lint && npm test`
Expected: typecheck 通过；lint 0 errors（warning 可接受）；test 全绿（pre-existing 失败不修）。

如果 baseline 已经红，**先停下**，报告给用户。

---

## Task 1: Step 1 — Page 端 session 校验去重

**Files:**
- Modify: 22 个 admin page 文件（清单见下）
- 不动: `src/lib/auth/require-admin.ts`（已存在，零修改）

**Interfaces:**
- Consumes: `import { requireAdmin } from '@/lib/auth/require-admin'` — 已存在，签名 `requireAdmin(): Promise<{ user: User; pathname: string }>`
- Produces: 每个 page 文件 `export default async function ...` 首行 `await requireAdmin()` 或 `const { user } = await requireAdmin()`

**精确清单**（22 个 page 文件，`grep -rl "validateSession" src/app/admin/ | grep "/page.tsx"` 的结果，除 `layout.tsx` 和已用 `requireAdmin()` 的3 个 database 文件）:

`src/app/admin/audit/page.tsx`
`src/app/admin/email/page.tsx`
`src/app/admin/email/log/page.tsx`
`src/app/admin/github-tokens/page.tsx`
`src/app/admin/github-tokens/[id]/page.tsx`
`src/app/admin/ingestion/page.tsx`
`src/app/admin/insights/page.tsx`
`src/app/admin/insights/health/page.tsx`
`src/app/admin/insights/languages/page.tsx`
`src/app/admin/insights/stale/page.tsx`
`src/app/admin/insights/top-repos/page.tsx`
`src/app/admin/providers/page.tsx`
`src/app/admin/providers/new/page.tsx`
`src/app/admin/providers/[id]/page.tsx`
`src/app/admin/queries/page.tsx`
`src/app/admin/queue/page.tsx`
`src/app/admin/refresh/page.tsx`
`src/app/admin/reports/page.tsx`
`src/app/admin/repositories/page.tsx`
`src/app/admin/users/page.tsx`
`src/app/admin/users/[id]/page.tsx`
`src/app/admin/webhooks/page.tsx`
`src/app/admin/webhooks/[id]/page.tsx`
`src/app/admin/repositories/[owner]/[name]/page.tsx`

实际清单按 `grep -rl "validateSession" src/app/admin/ | grep "page\.tsx$" | grep -v "/database/" | grep -v "layout\.tsx"` 在 Task 1.0 重新确认。

**改动模式**（以 `src/app/admin/users/page.tsx` 为例）：

当前（line 41-52）:
```ts
const cookieStore = await cookies();
const cookieMap = Object.fromEntries(cookieStore.getAll().map((c) => [c.name, c.value]));
const user = await validateSession({
  headers: new Headers(),
  cookies: {
    get: (name: string) =>
      cookieMap[name] !== undefined ? { value: cookieMap[name]! } : undefined,
  },
});
if (!user || user.role !== 'admin') {
  redirect('/admin');
}
```

改为:
```ts
const { user } = await requireAdmin();
```

import 改动:
- 删: `import { cookies } from 'next/headers';`（如只为 session 校验用）
- 删: `import { validateSession } from '@/lib/auth/session';`
- 删: `import { redirect } from 'next/navigation';`（**仅当页面其他处不再用 `redirect`** —— 必须 `grep` 确认）
- 加: `import { requireAdmin } from '@/lib/auth/require-admin';`

注意 `users/page.tsx:54` 用了 `user.timezone`，所以必须 `const { user } = await requireAdmin()` 而不是裸调。其他页面如不用 `user`，可写 `await requireAdmin()`。

- [ ] **Step 1.0: 重新确认精确清单**

Run: `grep -rl "validateSession" src/app/admin/ | grep "page\.tsx$" | grep -v "/database/" | grep -v "layout\.tsx" | sort > /tmp/step1-files.txt && cat /tmp/step1-files.txt | wc -l`
Expected: 一个数字（22~25 之间）。把这个数字记下来——实际清单可能和上方略异。

如果 `grep` 输出含任何 `api-settings/page.tsx` 之类（说明已经用 requireAdmin），从清单中删。

- [ ] **Step 1.1: 人工逐文件改第一个 page（拿 users/page.tsx 练手）**

Files: `src/app/admin/users/page.tsx`

按上面「改动模式」执行。改完后跑:
Run: `npm run typecheck 2>&1 | grep -E "users/page|error TS" | head -5`
Expected: 0 error 提到 `users/page.tsx`。

- [ ] **Step 1.2: 跑三门**

Run: `npm run typecheck && npm run lint && npm test`
Expected: 全绿（pre-existing 失败忽略）。

- [ ] **Step 1.3: 重复 Step 1.1 处理其余 ~21 个 page**

每个 page 改完单独跑一次 `npm run typecheck 2>&1 | grep -E "<file>" | head`。任何报错立即停下修。

**重点注意**:
- 部分 page 用 `redirect('/login')` 而不是 `redirect('/admin')` —— 这种 page 当前 session 不存在时重定向到 login，新版 `requireAdmin()` 也重定向到 login，**行为等价**。不需要额外处理。
- 部分 page 可能用 `user.id` / `user.email` —— 改用 `const { user } = await requireAdmin()`。
- 部分 page 可能还需要 `redirect()` 处理其他场景（如提交后跳转）—— 保留 `redirect` import。
- 部分 page 可能用 `cookies()` 拿别的 cookie（如 theme / variant）—— 保留 `cookies` import。

- [ ] **Step 1.4: 跑最终三门**

Run: `npm run typecheck && npm run lint && npm test`
Expected: 全绿。

- [ ] **Step 1.5: 手动 smoke test**

Run:
- 启动 dev server (`npm run dev:server`)
- 浏览器登录 admin → 访问每个改过的 page → 应该与重构前完全一致
- 浏览器注销 → 访问任意 admin page → 应重定向 `/login`
- operator 登录（如果有）→ 访问 `/admin/users` → 应重定向 `/admin`

- [ ] **Step 1.6: Commit**

Run:
```bash
git diff --stat
git add src/app/admin/users/page.tsx ... # 所有改过的文件
git commit -m "refactor(admin): use shared requireAdmin in N pages

Replace 12-line inline cookies()/validateSession/redirect blocks in
22 admin pages with single-line requireAdmin() call from
src/lib/auth/require-admin.ts.

Behavior unchanged: requireAdmin() redirects /login on missing session
and /admin on non-admin role — same as inline versions.

Keeps layout.tsx second-layer guard (defense in depth).
database/* 3 pages unchanged (already used requireAdmin)."
```

---

## Task 2: Step 2 — Route handler 认证去重（仅 users/[id]）

**Files:**
- Modify: `src/app/admin/layout.tsx` 之外的唯一一个 route handler
- 实际修改: `src/app/api/admin/users/[id]/route.ts`（去掉局部 `requireAdmin`，改为 `requireAdminFromRequest`）
- Modify: `src/lib/auth/require-admin.ts`（新增 `requireAdminFromRequest` 导出，约25 行）

**Interfaces:**
- Produces: `requireAdminFromRequest(req: Request): Promise<{ ok: true; user: User } | { ok: false; response: Response }>`，从 `src/lib/auth/require-admin.ts` 导出
- Consumes（被新函数）: `getSessionIdFromCookie` / `findSessionById`（来自 `@/lib/auth/session`），`apiError`（来自 `@/lib/api/errors`）

**关键发现**:
- `users/[id]/route.ts:30` 的局部 `requireAdmin(req)` 使用 `cookiesFromRequest(req)`（从 `@/lib/auth/cookies-from-request`）拿到 cookie map，然后传给 `validateSession`
- `apiError` 实际签名是 `apiError('forbidden', 'forbidden', {}, req)`（4 参数：error code, message, details?, request）
- 新 helper 必须吃 `req: Request` 而不是依赖 Next.js `cookies()`

- [ ] **Step 2.1: 在 `src/lib/auth/require-admin.ts` 末尾新增 `requireAdminFromRequest`**

当前文件末尾（line 52）是 `}` 关闭原 `requireAdmin` 函数。**不要**改 `requireAdmin` 本体，只追加：

```ts
// ===== Step 2: route handler variant =====

interface AdminRouteAuthResult {
  ok: true;
  user: User;
}
interface AdminRouteAuthFail {
  ok: false;
  response: Response;
}

/**
 * Route-handler variant of requireAdmin().
 *
 * Same semantics as the page variant (requireAdmin) but:
 *  - Takes a Request / NextRequest instead of calling cookies()/headers()
 *    (route handlers get the request, not server-component cookie APIs).
 *  - Returns Response on failure instead of redirecting — routes must
 *    reply with JSON, not navigate.
 *
 * Returns { ok: true, user } on success; { ok: false, response } on
 * 401 (missing/expired session) or 403 (non-admin role).
 *
 * Usage in a route handler:
 * ```ts
 * export async function PATCH(req: NextRequest, { params }) {
 *   const auth = await requireAdminFromRequest(req);
 *   if (!auth.ok) return auth.response;
 *   const { user } = auth;
 *   // ...rest
 * }
 * ```
 */
export async function requireAdminFromRequest(
  req: Request,
): Promise<AdminRouteAuthResult | AdminRouteAuthFail> {
  const id = getSessionIdFromCookie(req);
  if (!id) {
    return { ok: false, response: apiError('unauthorized', 'unauthorized', {}, req) };
  }
  const session = await findSessionById(id);
  if (!session) {
    return { ok: false, response: apiError('unauthorized', 'unauthorized', {}, req) };
  }
  if (session.user.role !== 'admin') {
    return { ok: false, response: apiError('forbidden', 'forbidden', {}, req) };
  }
  return { ok: true, user: session.user };
}
```

需要在文件顶部加 import:
```ts
import { apiError } from '@/lib/api/errors';
```

检查现有 `require-admin.ts` 是否已 import `getSessionIdFromCookie` / `findSessionById` —— **没有**，需要加:
```ts
import { getSessionIdFromCookie, findSessionById } from '@/lib/auth/session';
```

（page 版 `requireAdmin()` 用的是 `validateSession`，但 route 版更直接用 `getSessionIdFromCookie` + `findSessionById` —— 避免重复构造 cookie map。）

- [ ] **Step 2.2: 跑 typecheck 验证新 helper 通过编译**

Run: `npm run typecheck 2>&1 | head -30`
Expected: 0 error。如果报错，**只可能**是 `apiError` 签名或 import 路径问题，按错误修。

- [ ] **Step 2.3: 改 `src/app/api/admin/users/[id]/route.ts`**

当前文件（line 3, 5）:
```ts
import { validateSession } from '@/lib/auth/session';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
```

改为:
```ts
import { requireAdminFromRequest } from '@/lib/auth/require-admin';
```

删除局部 `requireAdmin` 函数（line 16-42，包括 `AuthOk`/`AuthFail` interface，line 30-42 函数体）。

删除 `cookiesFromRequest` import（route 文件已不需要）。

修改 PATCH handler（line 61-66）:
当前:
```ts
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;
```
改为:
```ts
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const auth = await requireAdminFromRequest(req);
  if (!auth.ok) return auth.response;
```

修改 DELETE handler（line 132-137）同样的两行替换。

注意 `auth.user.id` 引用（PATCH `:93,97,105` 和 DELETE `:172`）保持不变 —— 新 helper 的 `user.id` 类型一致。

- [ ] **Step 2.4: 跑 typecheck + lint**

Run: `npm run typecheck 2>&1 | head -30 && npm run lint 2>&1 | grep -E "users/\[id\]/route|error" | head -10`
Expected: 0 error。

- [ ] **Step 2.5: 跑 vitest**

Run: `npm test 2>&1 | tail -30`
Expected: 全绿（pre-existing 失败忽略）。

- [ ] **Step 2.6: 手动 smoke test**

Run:
- 启动 dev server
- 浏览器未登录 → DevTools network panel → `curl -X PATCH http://localhost:5002/api/admin/users/1 -d '{}'` → 应返回 401（带 `apiError` JSON body）
- operator 登录 → `curl -X PATCH http://localhost:5002/api/admin/users/1 -d '{}'` → 应返回 403
- admin 登录 → 浏览器访问 `/admin/users`，approve / disable 一个用户 → 应正常工作

- [ ] **Step 2.7: Commit**

Run:
```bash
git diff --stat
git add src/lib/auth/require-admin.ts src/app/api/admin/users/[id]/route.ts
git commit -m "refactor(admin/api): use shared requireAdminFromRequest in users/[id]

Replace local requireAdmin() helper in /api/admin/users/[id]/route.ts
with shared requireAdminFromRequest() from src/lib/auth/require-admin.ts.

The new helper returns Response (apiError) on failure instead of
redirecting — same semantics as the local version.

Only 1 route handler had local requireAdmin; the other 25 mutating
routes have no role check at all (operator can call them). That gap
is out of scope for this plan; tracked separately."
```

---

## Task 3: Step 3 — adminFetch 封装 + 数据获取规则文档

**Files:**
- Create: `src/lib/api/admin-fetch.ts`（约 40 行）
- Create: `docs/admin-data-fetch.md`（约 50 行）
- Modify: 11 个 client component 文件（清单见下）

**Interfaces:**
- Produces: `adminFetch<T = unknown>(url: string, init?: AdminFetchInit): Promise<T>` 从 `@/lib/api/admin-fetch` 导出
- Consumes: `fetchCsrfToken` 从 `@/lib/csrf/client`（已存在）

**精确清单**（11 个含 `fetch('/api/admin` 的 client component，按 grep 结果）:

`src/app/admin/_components/admin-status-bar.tsx`（轮询 GET，特殊处理见 Step 3.3）
`src/app/admin/database/_components/backup-section.tsx`
`src/app/admin/database/_components/restore-section.tsx`
`src/app/admin/email/_components/test-send-button.tsx`
`src/app/admin/github-tokens/_components/add-token-form.tsx`
`src/app/admin/ingestion/_components/run-via-provider.tsx`
`src/app/admin/queue/_components/queue-controls.tsx`
`src/app/admin/refresh/_components/refresh-controls.tsx`
`src/app/admin/users/_components/invite-form.tsx`
`src/app/admin/webhooks/_components/add-webhook-form.tsx`

实际清单按 `grep -r "fetch('/api/admin" src/app/admin/ -l` 在 Task 3.0 重新确认。

`src/app/admin/logout-button.tsx` 也匹配（fetch `/api/admin/auth/logout`），**计入**清单（属于 admin fetch）。

- [ ] **Step 3.0: 重新确认精确清单**

Run: `grep -r "fetch('/api/admin" src/app/admin/ -l | sort > /tmp/step3-files.txt && cat /tmp/step3-files.txt | wc -l`
Expected: 10~12 之间。

- [ ] **Step 3.1: 创建 `src/lib/api/admin-fetch.ts`**

文件内容:
```ts
import { fetchCsrfToken } from '@/lib/csrf/client';

export type AdminFetchInit = Omit<RequestInit, 'body' | 'headers'> & {
  body?: unknown;
  headers?: Record<string, string>;
};

/**
 * Fetch wrapper for /api/admin/* mutations (and the occasional GET).
 *
 * Behavior:
 *  - Auto-injects `credentials: 'include'` so Set-Cookie persists.
 *  - Auto-injects `x-csrf-token` header from fetchCsrfToken() (single-flight
 *    coalesced; M28.bug).
 *  - JSON-encodes `body` if it's a plain object (FormData / string pass through).
 *  - Throws Error('adminFetch ${status}: ${body}') on non-2xx.
 *  - Returns parsed JSON on 2xx; undefined on 204 / non-JSON.
 *
 * Use this instead of raw fetch() in any admin client component that
 * hits /api/admin/*. See docs/admin-data-fetch.md for policy.
 */
export async function adminFetch<T = unknown>(
  url: string,
  init: AdminFetchInit = {},
): Promise<T> {
  const { body, headers = {}, ...rest } = init;
  const csrf = await fetchCsrfToken();
  const finalHeaders: Record<string, string> = {
    ...headers,
    'x-csrf-token': csrf,
  };
  let payload: BodyInit | undefined;
  if (
    body !== undefined &&
    !(body instanceof FormData) &&
    typeof body !== 'string'
  ) {
    finalHeaders['content-type'] = finalHeaders['content-type'] ?? 'application/json';
    payload = JSON.stringify(body);
  } else {
    payload = body as BodyInit | undefined;
  }
  const res = await fetch(url, {
    ...rest,
    credentials: 'include',
    headers: finalHeaders,
    body: payload,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`adminFetch ${res.status}: ${text || res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Reset the shared CSRF cache. Useful in test environments or after a
 * logout/login cycle where the cookie was rotated out-of-band.
 *
 * Re-exported from @/lib/csrf/client for convenience so callers don't
 * need to import both modules.
 */
export { resetCsrfCache } from '@/lib/csrf/client';
```

- [ ] **Step 3.2: 跑 typecheck 验证新 helper 通过编译**

Run: `npm run typecheck 2>&1 | head -20`
Expected: 0 error。

- [ ] **Step 3.3: 替换第一个调用点（拿最简单的 `users/_components/invite-form.tsx` 练手）**

Read `src/app/admin/users/_components/invite-form.tsx` 当前 fetch 调用。

模式 A（典型 POST/PATCH 带 JSON body）:
当前:
```ts
const csrf = await fetchCsrfToken();
const res = await fetch('/api/admin/users/invite', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
  body: JSON.stringify({ ...payload, csrf }),
});
```
改为:
```ts
import { adminFetch } from '@/lib/api/admin-fetch';
// ...
const data = await adminFetch<{ ok: true } | { error: string }>('/api/admin/users/invite', {
  method: 'POST',
  body: { ...payload, csrf },
});
```

注意: `adminFetch` 已经注入 `x-csrf-token` header 和 `credentials: 'include'`，调用方 **不再需要手动拿 csrf token 也不需要 JSON.stringify**。但调用方仍可能要在 body 里塞 `csrf`（route handler 可能校验 body.csrf）—— **保留 body 里的 csrf**，由调用方自己负责。

模式 B（FormData）:
当前:
```ts
const csrf = await fetchCsrfToken();
const fd = new FormData();
fd.set('csrf', csrf);
fd.set('foo', 'bar');
const res = await fetch('/api/admin/...', { method: 'POST', body: fd });
```
改为:
```ts
const fd = new FormData();
fd.set('csrf', csrf);  // 调用方仍要塞 csrf（如果 route 校验 body）
fd.set('foo', 'bar');
await adminFetch('/api/admin/...', { method: 'POST', body: fd });
```

模式 C（GET 轮询）:
当前:
```ts
const res = await fetch('/api/admin/status', { credentials: 'include' });
const data = await res.json();
```
改为:
```ts
const data = await adminFetch<StatusData>('/api/admin/status');
```

注意: 这次替换会**多发一次 `/api/admin/auth/csrf` 请求**（GET 原本不需要 csrf，但 adminFetch 总会调用 fetchCsrfToken）。这是有意的权衡：统一 wrapper 优先级高于单次往返。可接受。

- [ ] **Step 3.4: 跑 typecheck + lint + test**

Run: `npm run typecheck && npm run lint && npm test`
Expected: 全绿。

- [ ] **Step 3.5: 重复 Step 3.3 处理其余 9~10 个 component**

每个文件改完单独跑一次 `npm run typecheck 2>&1 | grep -E "<file>"`。

**重点注意**:
- `logout-button.tsx` 调的是 `/api/admin/auth/logout`（注意不是 `/api/admin/logout`）—— 替换 URL 不变
- `admin-status-bar.tsx` 的 GET 轮询走 adminFetch 会多发一次 csrf 请求 —— 接受
- 任何 component 如果之前自己 import 了 `fetchCsrfToken` 仅用于给 header 注入 —— 删除该 import（adminFetch 内部处理）
- 任何 component 如果还有 `.ok` / `.status` 判断 —— 改为 try/catch 或保留判断 + 适配 adminFetch throw

- [ ] **Step 3.6: 创建 `docs/admin-data-fetch.md`**

文件内容:
```md
# Admin Data-Fetch Policy

Three patterns coexist intentionally. New pages must pick one based on
the operation type, not personal preference.

## Pattern 1: Server Component + `src/lib/db/*` helper

**When:** reading data for the initial render of an admin page.

**Why:** no client round-trip, no JSON serialization, can stream JSX,
supports Suspense.

**Example:** `/admin/users` — `import { listUsers } from '@/lib/db/users'`,
called inline in the page server component.

**Don't:** import `prisma` from `@/lib/db/client` directly in a page.
Always go through a helper in `src/lib/db/*`.

## Pattern 2: Server Action + `useActionState`

**When:** forms that mutate settings and want inline feedback without
leaving the page (no full reload).

**Why:** progressive enhancement, no JS round-trip on submit, simple
state-machine via `useActionState`.

**Example:** `/admin/api-settings`, `/admin/email`.

**Don't:** use this for row-level operations (approve key, disable user)
— those should be optimistic UI from a client component using adminFetch.

## Pattern 3: Client component + `adminFetch`

**When:** row-level mutations from a table (approve / revoke / disable /
toggle / delete) where the user expects instant feedback and possibly
optimistic updates.

**Why:** stays on the page, can update local state, can show inline
toast / inline `<p role="status">`.

**Example:** `src/app/admin/api-keys/_components/key-row-actions.tsx` —
calls `adminFetch('/api/admin/api-keys/${id}/approve', { method: 'POST' })`.

**Don't:** use raw `fetch('/api/admin/...')` — always go through
`adminFetch` so CSRF + credentials are wired correctly.

## What we explicitly DON'T do

- No global toast system (yet).
- No `redirect()` + searchParams flash pattern.
- No client-side SWR / React Query / etc.
- No `@/lib/api/` client helper other than adminFetch.
- No raw `fetch('/api/admin/...')` in client components.
```

- [ ] **Step 3.7: 跑最终三门**

Run: `npm run typecheck && npm run lint && npm test`
Expected: 全绿。

- [ ] **Step 3.8: 手动 smoke test**

Run:
- 启动 dev server
- 浏览器登录 admin
- 触发 mutation（approve API key / disable user / add webhook / send test email）
- DevTools network panel: 每个 mutation 请求应有 `x-csrf-token` header + `Cookie` header
- DevTools network panel: 每个 mutation 之前应有一次 `/api/admin/auth/csrf` 请求（被 adminFetch 内部触发）
- 浏览器未登录访问 admin page → 应重定向 `/login`
- 浏览器注销 → 重新登录 → 重试 mutation → 应正常工作

- [ ] **Step 3.9: Commit**

Run:
```bash
git add src/lib/api/admin-fetch.ts docs/admin-data-fetch.md
git commit -m "feat(lib): add adminFetch wrapper + admin data-fetch policy doc

- New src/lib/api/admin-fetch.ts: thin wrapper around fetch() for
  /api/admin/* requests. Auto-injects credentials + x-csrf-token
  header (from existing fetchCsrfToken()). JSON-encodes plain object
  bodies; throws on non-2xx.
- New docs/admin-data-fetch.md: codifies the 3 official patterns
  (Server Component + lib/db, Server Action + useActionState, client
  + adminFetch). Explicitly forbids raw fetch() to /api/admin/*,
  global toast, SWR/React Query, searchParams flash.
- Refactor N client components to use adminFetch instead of raw
  fetch(). No behavior change."
```

---

## 任务结束验证

- [ ] **Final: 三个 commit 都已 push 到本地 master**

Run: `git log --oneline -4 docs/superpowers/specs/2026-09-09-admin-connection-unification-design.md docs/superpowers/plans/2026-09-09-admin-connection-unification.md src/lib/auth/require-admin.ts src/lib/api/admin-fetch.ts docs/admin-data-fetch.md`
Expected: 看到 spec commit + plan commit + 3 个 step commit。

- [ ] **Final: 最终 typecheck + lint + test**

Run: `npm run typecheck && npm run lint && npm test`
Expected: 全绿。

- [ ] **Final: 报告给用户**

3 个 commit hash + 净行数变化 + 是否需要为另外 25 个无 role check 的 route 写独立 spec。