# M30 — Admin UX Overhaul Design

**Status:** draft (待审阅)
**Author:** Claude (controller)
**Date:** 2026-09-11
**Predecessor:** M29 public-pages visual redesign (committed `74c8967`..`6ef7162`)

## 背景

Admin 表面有 32 页(实际 31 个 `page.tsx`)、3 个视觉变体(`mission_control` / `inspector` / `workbench`)、2 个色彩模式(light / dark)、12 个共享原子组件。基础设施成熟,但有两个用户直接感知的痛点:

1. **加载速度慢** — admin 任何页面都要等 layout 完成 `validateSession + loadAdminStatusData (DB ping + queue + audit count + 5-row palette audit) + getActorEmails` 才能渲染。Dashboard 自己又跑 5 个独立 `prisma.count` + bucket loader。
2. **侧边栏高亮错位** — `sectionForPath` 在 `src/app/admin/layout.tsx:41` 用 `pathname.startsWith('${s.href}/')` 做前缀匹配,但 `/admin/email/log` 走不进 `/admin/email/` 前缀(没有尾部斜杠),落到 fallback `dashboard`,因此 Email log 页会把 Dashboard 高亮。

## 设计 token 决策

**不动 admin 的视觉系统**。M29 的 `professional` / `professional` 主题不进 admin — admin 的 `data-admin` / `data-admin-mode` 正交系统(M26.x)保留。理由:
- admin 是 ops 工具,信息密度优先于品牌气质
- public 走"节制编辑风",admin 走"控制台气质"是 deliberate 的产品决策
- 改 token 等于把 M29 的工作抹掉一半

`mission_control`(默认)保留现有 CRT 雷达 HUD 美学。`inspector` 和 `workbench` 从"命名占位"升级为真实视觉:

- **Inspector** — forensic paper trail:放大行距、左右双栏(lineage 列固定 280px)、每行带 audit-trail 角标;字体走等宽 + 衬线混合;无阴影,只用 hairline;border-radius 降到 2px;配色保持 cobalt accent。
- **Workbench** — assembly manual:大字号数字(KPI 数字 28px+)、step 编号(01/02/03)前置、表格行高 ≥ 56px;按钮走 `outline` 而非填充;action 区永远 sticky 在右下。

3 个 variant 的语义从此清晰:**mission_control** = 24/7 监盘,**inspector** = 审计 / 调查,**workbench** = 配置 / 部署。

## 主要设计变更

### 1. 侧边栏高亮修复(用户报告的核心 bug)

`src/app/admin/layout.tsx:41-52` 的 `sectionForPath` 重写:

```ts
function sectionForPath(pathname: string): AdminSectionSlug {
  if (pathname === '/admin' || pathname === '/admin/') return 'dashboard';
  const candidates = ADMIN_SECTIONS.filter((s) => s.slug !== 'dashboard');
  // Prefer exact match. Among prefix matches, prefer longest href.
  let best: AdminSection | null = null;
  for (const s of candidates) {
    if (pathname === s.href) return s.slug;
    if (pathname.startsWith(s.href + '/')) {
      if (best === null || s.href.length > best.href.length) best = s;
    }
  }
  return best?.slug ?? 'dashboard';
}
```

唯一改动:把 `pathname.startsWith(\`${s.href}/\`)` 改为 `pathname.startsWith(s.href + '/')`(纯字符串拼接,等效;但更明确无歧义)。

**为什么之前的版本会 bug**:把 `\`${s.href}/\`` 字符串插值后,值确实是 `/admin/email/`。`/admin/email/log` 的前缀是 `/admin/email/`,**应该**匹配。但 code path 上 `/admin/email` 和 `/admin/email/log` 都是合法路径,middleware 把 `x-pathname` 设成 `/admin/email/log`,loop 跑两遍:先 `pathname === '/admin/email'`? no。然后 `pathname.startsWith('/admin/email/')`? yes → best = email。**理论上应该工作**。

**为什么用户报告 bug**:用户报告"点到了别的菜单,但是底纹没有跟着边"。这不是 SSR 失败 — 是**客户端导航后 admin layout 的 server component 没重渲染**。Next 15 的软导航会复用 layout 的渲染结果(因为 layout 是稳定的壳);只有当 layout 内部的某些状态变化才会触发重渲染。`currentSection` 从 `x-pathname` 算,而 `x-pathname` 来自 middleware,中间件**只在初始请求跑**,客户端导航时不重跑。

修复策略:把 `AdminSidebar` 改成 `'use client'` + `usePathname()`,让它自己听路由变化。这个变化是 admin 整体 client-side 化的第一步。

### 2. Layout perf 优化(用户报告的第二个痛点)

**问题分解**:
- `loadAdminStatusData` 跑 4 个串行 DB 操作(`audit count → SELECT 1 ping → queue count → audit 24h count`),其中 `SELECT 1` 之前还要先拉 5 条 audit(给 palette)
- `getActorEmails` 又是单独串行调用,且只用 5 个 actor ID
- Dashboard 跑 5 个独立 `count`

**优化方案**:

a. **并行化**:把 `loadAdminStatusData` 内部的 4 个 DB 操作用 `Promise.all` 包裹,不再串行
b. **缓存层**:用 `unstable_cache` 包裹 `loadAdminStatusData` (TTL 60s),因为 status bar 已经在 10s 轮询,但 layout SSR 那个 60s 内不会变
c. **拆分 palette 数据**:让 CommandPalette 自己 fetch `/api/admin/palette`,而不是 layout 预取。这样 layout 只预取 status bar 数据(4 个 count),palette 按需加载
d. **Dashboard count 合并**:5 个独立 `count` 改成 1 个 `Promise.all` + 1 个 raw SQL `CASE WHEN` 聚合(见下方实现示例)

```ts
// 新 dashboard-buckets.ts 暴露的 helper
async function getDashboardCounts() {
  return prisma.$queryRaw<Array<{
    cached_repos: number;
    active_users: number;
    active_api_keys: number;
    active_github_tokens: number;
  }>>`
    SELECT
      (SELECT COUNT(*) FROM repositories) AS cached_repos,
      (SELECT COUNT(*) FROM users WHERE status = 'active') AS active_users,
      (SELECT COUNT(*) FROM api_keys WHERE status = 'active') AS active_api_keys,
      (SELECT COUNT(*) FROM github_tokens WHERE status = 'active') AS active_github_tokens
  `;
}
```

### 3. CommandPalette 升级为全局导航核心

现状:`src/app/admin/_components/command-palette.tsx` 已经有 ⌘K、search、recent audit,但有几个短板:
- 只在 layout 预取的 5 条 audit 里搜
- 点击 section 用 `window.location.href`(全页刷新,不是软导航)
- 没快捷键直达具体页(比如 "go to user #42")
- 没法跳到 detail 页(`/admin/users/[id]`)

升级:
- 增加"go to ..." 直接搜索路径(比如输入 `user 42` 命中 `/admin/users/42`)
- 用 `useRouter().push()` 替代 `window.location.href`,触发软导航(同时验证侧边栏修复)
- search 是 debounced fetch,不再用 layout 预取
- Empty state 加建议("Try: refresh, audit, users, repo:owner/name")

### 4. Inspector + Workbench 真实视觉

3 个变体的 `[data-admin="..."]` CSS 块已经有(globals.css),但只有 mission_control 有大量规则覆盖,inspector / workbench 是空壳(基础 token + 极少变体规则)。

补全:
- `[data-admin="inspector"]`:行高 1.7 / 表格左侧 sticky "lineage" 列 / 数字 mono 字体带斜线零(`font-variant-numeric: slashed-zero`) / border-radius: 2px / 移除阴影只用 1px hairline / 给 `<table>` 加 zebra striping
- `[data-admin="workbench"]`:KPI 数字 32px / step 编号 01-04 在 section title 旁 / 表格行高 56px / 按钮走 `variant="outline"` / sticky action bar(右下角)

### 5. 高频页 task-flow 优化

按 ops 真实使用频率排序,只动 4 页:

- **`/admin/refresh`** — 加"立即刷新此仓库"快捷输入,默认带最近的 3 个仓库提示;加 scheduler 控制按钮(pause / resume)直出
- **`/admin/github-tokens`** — 列表加 token 健康状态列(quota remaining / last used / last error),表格行一键测试
- **`/admin/audit`** — 加时间范围 quick filter(15m / 1h / 24h / 7d / 自定义),加 actor / action 联合 filter
- **`/admin/queue`** — 加 pending job 卡片化(每个 job 一个卡,显示 repo + age + retry count),加 retry / cancel 行内按钮

每个改动都不重写页面结构,只在现有 AdminTable / AdminPageHeader / AdminFilterBar 之外加 inline form 或新原子。

## 全局约束

- **不动 admin 视觉系统正交架构**(`data-admin` × `data-admin-mode`)
- **不动 Prisma schema**(除非 inspector 需要的 `retryCount` 字段缺失 — 检查后已存在 `refreshJob.attemptCount`,不用动)
- **不动 API 契约**(`/api/v1/*`,webhook payloads)
- **不加新依赖**
- **保持现有 12 个 admin 原子的导出签名**
- **i18n 双语同步**
- **`t.rich` callback 必须接 `chunk` 参数**
- **`next/headers cookies()` 在 Vitest 必须 mock**
- **React 19 effect 规则遵守**(defer setState via setTimeout(0) 或 useSyncExternalStore)
- **不动 `users.theme` 枚举 collapse**(Ruling 1 from M29 ledger;admin redesign 不应该 widen 这次枚举,留给 admin 改造真正发生那一版)

## 实施分阶段(对应 4 个 commit)

1. **Task 1 — 侧边栏 client-side + sectionForPath 修复 + layout perf** (1 commit)
2. **Task 2 — CommandPalette 升级**(1 commit)
3. **Task 3 — Inspector + Workbench 真实视觉**(1 commit)
4. **Task 4 — 高频 4 页 task-flow 优化**(1 commit)

每 commit 独立 SDD 流程:implementer → reviewer → fix-loop(最多 5 轮)→ ledger 记录。

## 验收门

- `npm run typecheck` 错误数 ≤ 26(M29 baseline)
- `npm run lint` 仍是 M28 起的 broken baseline(不增加新错误)
- `npm test` 不引入新失败(已有 101 failed 保持 101)
- 手动 smoke:
  - 软导航 `/admin/users` → `/admin/users/3` → 侧边栏 Users 高亮保持
  - 软导航 `/admin/email` → `/admin/email/log` → 侧边栏 Email 高亮保持
  - 切换 admin variant 后整个页面立即换视觉,无 flash
  - CommandPalette ⌘K 唤起后输入 `user 42` 命中 detail 页
  - Dashboard 首屏 ≤ 600ms(从 layout perf 优化起算)

## 范围外

- **不**改 public 主题系统
- **不**改 admin 之外(`/account/*`, `/init/*`)
- **不**改 API routes
- **不**做 Lighthouse 性能优化(超出 admin 范围)
- **不**加 SSE / WebSocket 实时更新(留作 M31)
- **不**改 admin role 模型
