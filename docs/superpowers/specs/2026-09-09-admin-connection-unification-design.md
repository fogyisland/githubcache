# Admin 连接层统一化设计

**状态**: 待审阅
**日期**: 2026-09-09
**范围**: Admin 后台「连接层」重构，不涉及架构层、风格层、通知 pattern 收敛

---

## 1. 背景与目标

`githubcache` admin 后台（M6–M28）已经搭好完整的视觉骨架（12 个 `_components/`，覆盖 32 个 admin 页面），但**组件外壳内部**的连接逻辑（认证 / CSRF / 数据获取）散落在各页面和 route handler 中，导致大量重复实现与隐式技术债。本次重构只解决连接层问题；架构层（少数 `import { prisma }` 绕过点）与风格层（`admin-pagination.tsx` 的 Tailwind 灰度类）另行处理。

**核心原则**: 零行为变更。所有改动都是「删复制粘贴 + 加 import + 加薄包装」。每个改动独立 commit，独立 revert。

**具体目标**:
- Step 1: 18 个 admin page 文件的 session 校验去重 → 统一调用 `requireAdmin()`
- Step 2: 17 个 `/api/admin/*` route handler 的认证去重 → 统一调用新增的 `requireAdminFromRequest()`
- Step 3: 24+ 处手写 `fetch('/api/admin/...')` → 统一封装 `adminFetch()`，并产出数据获取规则文档

**明确不做**:
- 4 种通知 pattern 收敛（保留现状）
- 全局 toast 系统引入
- 删除 `admin/layout.tsx` 的第二层 session 守卫（保留双层防御纵深）
- 风格层改造（Tailwind 类替换为 `ghc-admin-*`）
- 架构层改造（3 处 `import { prisma }` 绕过点）

---

## 2. 设计概要

### 2.1 Step 1：page 端 session 校验去重

**现状**: 18 个 page 文件各自复制粘贴 12 行 `cookies()/validateSession/redirect` 块。`src/lib/auth/require-admin.ts`（M28 引入）已经是成品，但只被 3 个页面使用。

**改动**: 在 18 个 page 文件中：
1. 删除局部 `import { cookies } from 'next/headers'` 和 `import { redirect } from 'next/navigation'`（如果只为 session 校验用）
2. 删除局部 `import { validateSession }` / `findSessionById`（如果只为 session 校验用）
3. 删除 12 行 session 校验块
4. 添加 `import { requireAdmin } from '@/lib/auth/require-admin'`
5. 在 page 函数体首行添加 `await requireAdmin()`
6. 如果 page 还需要 `user` 对象（如 `users/[id]/page.tsx` 用了 `user.email`），改为 `const { user } = await requireAdmin()`

**保留**:
- `admin/layout.tsx:81-91` 的 session 守卫**不动**（防御纵深）
- `database/page.tsx` / `database/schema/page.tsx` / `database/operations/page.tsx` 已经用 `requireAdmin()`，**不动**

**验收**: typecheck + lint + vitest 全绿；手动访问每个改动页面表现与重构前完全相同。

### 2.2 Step 2：route handler 认证去重

**现状**: 17 个 `/api/admin/*` route handler 各自实现一个局部的 `async function requireAdmin(req: NextRequest): Promise<User | Response>`，5~10 行不等。

**改动**: 在 `src/lib/auth/require-admin.ts` 末尾新增导出 `requireAdminFromRequest(req: NextRequest)`：
- 复用现有 `getSessionIdFromCookie` / `findSessionById`
- 不调用 `redirect()`，而是用 `apiError()` 返回 401 / 403 Response
- 返回判别式 union: `{ ok: true; user: User } | { ok: false; response: Response }`

在 17 个 route handler 中：
1. 删除局部 `requireAdmin(req)` 函数定义
2. 删除独立的 `import { getSessionIdFromCookie }` / `import { findSessionById }`（如果只为认证用）
3. 添加 `import { requireAdminFromRequest } from '@/lib/auth/require-admin'`
4. 在每个 HTTP 方法 handler 首行添加：
   ```ts
   const auth = await requireAdminFromRequest(req);
   if (!auth.ok) return auth.response;
   const { user } = auth;
   ```

**精确范围**: 仅替换已含局部 `requireAdmin` 函数的 handler。Read-only GET route（`audit`、`palette`、`status`、`reports`、`database/backup` GET 等）如果当前没有认证守卫则不动。

**验收**: typecheck + lint + vitest 全绿；手动验证三类场景:
- 未登录访问任意 mutating route → 返回 401
- operator 访问 admin-only route → 返回 403
- admin 访问 → 正常结果

### 2.3 Step 3：adminFetch 封装 + 数据获取规则文档

**目标 A**: 新建 `src/lib/api/admin-fetch.ts`：

```ts
export async function adminFetch<T = unknown>(
  url: string,
  init?: { method?: string; body?: unknown; headers?: Record<string, string> },
): Promise<T>
```

行为：
- 自动注入 `credentials: 'include'`（cookie 持久化）
- 自动从 `fetchCsrfToken()`（已存在的 `src/lib/csrf/client.ts`）取 token 注入 `x-csrf-token` header
- `body` 是对象时自动 JSON 序列化并加 `content-type: application/json`（FormData / string 跳过）
- 非 2xx 抛 `Error('adminFetch ${status}: ${body}')`
- 2xx 且响应是 JSON 则 `.json()` 返回；否则返回 `undefined`

替换 24+ 处手写 `fetch('/api/admin/...', { headers: { 'x-csrf-token': csrf }, ... })` 调用，逐文件改：
1. `import { adminFetch } from '@/lib/api/admin-fetch'`
2. 把 `await fetch(url, { headers: { ..., 'x-csrf-token': csrf }, ... })` 替换为 `await adminFetch(url, { ... })`

**目标 B**: 新建 `docs/admin-data-fetch.md`，明确三种数据获取 pattern 的适用场景：
- Server Component + `src/lib/db/*` helper：用于页面初始渲染
- Server Action + `useActionState`：用于表单提交并希望保留页面（settings / config）
- Client component + `adminFetch`：用于行级即时操作（approve / revoke / disable / toggle）

明确禁止：手写 `fetch('/api/admin/...')`、全局 toast、`redirect()` + searchParams flash pattern、第三方数据获取库（SWR / React Query 等）。

**精确范围**: 实施前用 `grep -r "fetch('/api/admin" src/app/admin/` 重新统计。含轮询的 `/api/admin/status` 也用 `adminFetch`（GET 不需要 CSRF，但调用会多发一次 `/api/admin/auth/csrf` 调用 —— 可接受，权衡是统一性 vs. 一次额外往返）。

**验收**: typecheck + lint + vitest 全绿；手动触发任意一个 mutation 验证行为完全相同。

---

## 3. 文件改动清单

### 3.1 新增文件

- `src/lib/api/admin-fetch.ts`（Step 3，约 40 行）
- `docs/admin-data-fetch.md`（Step 3，约 50 行）
- 本 spec 文件自身

### 3.2 修改文件

**`src/lib/auth/require-admin.ts`**（Step 2 末尾新增约 25 行导出）

**~18 个 admin page 文件**（Step 1，每文件减约 10 行）：
精确清单需实施前 `grep "validateSession" src/app/admin/ -r` 确认。agent 1 调研时估的是 18；如精确 grep 后数字略有出入（如 17 或 19），按 grep 结果执行，规则不变:凡是在 page 文件中直接调用 `validateSession` 的，都迁到 `requireAdmin()`。

**17 个 `/api/admin/*` route handler 文件**（Step 2，每文件减约 8 行）：
精确清单需实施前 `grep "function requireAdmin" src/app/api/admin/ -r` 确认

**24+ 个 client component 文件**（Step 3，每文件改 ~3 行）：
精确清单需实施前 `grep "fetch('/api/admin" src/app/admin/ -r` 确认

### 3.3 不动的文件

- `src/app/admin/layout.tsx`（保留双层 session 守卫）
- `src/lib/auth/csrf.ts`、`src/lib/auth/session.ts`（已用，新代码不重复）
- `src/lib/csrf/client.ts`（已实现，新代码直接复用）
- `src/lib/api/errors.ts`、`src/lib/api/request-id.ts`（server-side，新代码不涉及）
- `src/lib/admin/status-loader.ts`、`src/lib/admin/dashboard-buckets.ts`（已正确抽象，不动）
- `src/app/admin/database/{page,schema/page,operations/page}.tsx`（已用 `requireAdmin()`）

---

## 4. 测试与验证

每步执行后必须满足以下验收门槛（项目 CLAUDE.md「Quality gates」）:
- `npm run typecheck` → 通过
- `npm run lint` → 0 errors（warning 可接受）
- `npm test` → 全绿

**额外手动验证**:

Step 1:
- 以 admin 登录，访问每个改动的页面，行为应与重构前完全相同

Step 2:
- 未登录 `curl -X PATCH http://localhost:5002/api/admin/users/1 -d '{}'` → 401
- operator 登录后 `curl -X PATCH ...` → 403
- admin 登录后 `curl -X PATCH ...` → 正常结果

Step 3:
- 触发任意一个 mutation（如 `/admin/api-keys` 上 approve 一个 key），观察网络面板: 请求应包含 `x-csrf-token` header 与 cookie

**不增加新测试**: 因为行为零变更，集成测试覆盖不变。

---

## 5. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| Page 端 `requireAdmin()` 返回的 `user` 对象与原 inline 版本不一致 | 页面崩溃或渲染异常 | 实施前用 `grep -r "session.user" src/app/admin/` 找出所有依赖 `user` 字段的页面，统一改用 `const { user } = await requireAdmin()` |
| Route handler 错误响应格式不一致（手写 `new Response()` vs `apiError()`） | 客户端解析失败 | 实施前 `grep -l "new Response" src/app/api/admin/` 找例外，逐个对齐到 `apiError()` 或保留手写 |
| adminFetch 替换手写 fetch 后，CSRF 注入行为变化 | 403 错误激增 | middleware 查 header，不查 body；某些 fetch 同时在 body 也带 csrf —— 这些页面**两处都有**（header + body），只删 body 的 csrf 即可。`grep "csrf" src/app/api/admin/` 确认无 route 校验 body.csrf |
| `adminFetch` 替换 `/api/admin/status` 轮询会多发一次 csrf 请求 | 极小性能影响 | 接受，或后续加 `skipCsrf` 旁路（**不在本次范围**） |
| `admin/layout.tsx` 保留第二层守卫，每次请求多一次 validateSession 调用 | 性能开销 | 可接受；如未来需要优化，单独处理 |

---

## 6. 实施顺序与交付

3 个独立 commit，按顺序执行，每步独立 revert:

| Commit | 标题 | 预计改动量 |
|---|---|---|
| 1 | `refactor(admin): use shared requireAdmin in N pages` | 18 文件，~−200 行 |
| 2 | `refactor(admin/api): use shared requireAdminFromRequest in N route handlers` | 17 文件 + 1 文件新增 ~25 行 |
| 3 | `refactor(admin): centralize admin fetch + document data-fetch policy` | 24+ 文件 + 2 文件新增 |

每步完成后跑 typecheck/lint/test，全绿后才进入下一步。

---

## 7. 后续工作（不在本次范围）

- 架构层: 3 处 `import { prisma }` 绕过点 + `repositories/[owner]/[name]/page.tsx` 内嵌 server action + Date.now() 提取约定扩散
- 风格层: `admin-pagination.tsx` 替换 Tailwind 灰度类为 `ghc-admin-*` + recharts 颜色接入 token
- 通知层: 4 种 pattern 收敛 + 全局 toast 系统（重大 UX 决策，需独立 brainstorming）
- CSRF fetch 多发一次: `/api/admin/status` 轮询加 `skipCsrf` 旁路（如确认需要）