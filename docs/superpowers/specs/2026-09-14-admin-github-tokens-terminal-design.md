# M32 — /admin/github-tokens Terminal 重设计

**Status:** draft (待审阅)
**Author:** Claude (controller)
**Date:** 2026-09-14
**Predecessor:** M30 (admin UX overhaul, merged)、M30.5 (follow-ups closed)、M30.7 manual smoke gate、M30.8 (admin sidebar groups, shipped)

## 背景

`/admin/github-tokens` 当前长这样(摘自 `src/app/admin/github-tokens/page.tsx`):

- `AdminPageHeader` 渲染浅色 breadcrumb + title + description(继承全局 AdminShell)
- 表格列:`label` / `prefix`(mono 前缀) / `status`(chip) / `pool`(chip) / `usage`(数字 + 百分比) / `quotaRemaining` / `lastUsed` / `lastError`(TODO 永远是 em-dash) / `test` / `actions`(enable/disable + delete 两个原生按钮 + 原生 `confirm()`)
- 表单:`AddTokenForm` 用原生 `<input>` / `<textarea>` / `<button>`,提交按钮裸样式,错误/成功用 `<p role="alert|status">` 平铺
- 空状态:仅 `emptyTitle` + `emptyDescription` 两行,无引导
- 全局调色板:`ghc-admin-*` 系列在浅色 AdminShell 之上,字体继承主题

用户原话:**"这个界面太简陋了 需要优化"**,并通过 AskUserQuestion 选定 **AddTokenForm + TokenActions 行内按钮 + token table 行 + Empty state 体验** 四项**全部**重做,且明确选了"完全视觉重设计"。

候选风格三选一(terminal / 极简工程 / 档案柜),用户选了 **terminal / 控制台风格**(#0d0d0d bg / #00ff88 ok / #ffaa00 warn / Berkeley Mono 全局)。

## 目标

1. `/admin/github-tokens` 在浅色 AdminShell 中**局部**变深色 terminal 主题,AdminPageHeader 留在终端框外。
2. 行内操作改为 `[t] test` / `[E/d] enable|disable` / `[x] delete` 这种单字符键风格按钮;删除前用内嵌 `$ confirm delete? [y/N]` 行替换原生 `confirm()`。
3. AddTokenForm 套上 terminal 风格:大写 mono label、`>` 提示符、单色输入框带 focus ring;成功/失败显示为带前缀的 log 行(`> ok` / `! err`)。
4. Empty state 改为 `$ ls tokens` + `no tokens found.` + `$ gh token create ...` + 嵌入式 add token 框;不是两块独立的"列表" + "表单"。
5. 维持 i18n 完整覆盖(`admin.githubTokens.*` 命名空间,en.json + zh.json 同步);所有交互组件保留 ARIA label / role。

## 关键决策

### 1. 范围限定:只改 `/admin/github-tokens` 一个页面

用户明确选择"只改 /admin/github-tokens 一个页面"(三个候选里最小 scope 选项)。

**取舍:** 不动 AdminShell / AdminSidebar / AdminTable / AdminPageHeader 的内部样式。代价是侧边栏跳到 github-tokens 页时会出现**一次** "亮 → 暗 → 亮" 跳变(顶 header 亮 + 主区暗 + 返回其他页时再亮)。可接受,因为:

- 范围最小,发布风险最低(只动一个路由 + 4 个子组件 + 1 套新 CSS)。
- 未来如果用户想扩展到全部 admin 页(全 AdminShell 改深色),这是另一份 spec / plan 的事。

**拒绝全 AdminShell 改深色:** 工作量翻 ~10 倍,测试翻 ~3 倍,踩到所有现有 admin 页的回归风险。

**拒绝双主题(adminVariant 切换):** 用户没要求;复杂度跳升一个量级(主题系统 + 切入口 + 设计/测试双份)。

### 2. AdminPageHeader 留在终端框外

`AdminPageHeader` 渲染 breadcrumb + title + description,保持默认浅色,位置在页面顶部,跟 `AdminShell` 其他页一致。terminal frame 从 description 下方开始,把 **pool status + tokens 表 + add token 表单 + pagination** 全部包进同一个深色框。

**取舍:** 一次"亮→暗"跳变之后,页面其余都在终端里。Header 留在外 = 视觉跟其他 admin 页保持关联(用户仍能通过 breadcrumb 确认自己在哪)。

**拒绝方案:** Header 进终端框内 — 视觉连贯但需要在 page.tsx 局部覆写 AdminPageHeader 的颜色;Header 完全改写为 `$ cd /admin/github-tokens` 风格 — 失去 AdminShell 提供的 a11y / 面包屑导航一致性。

### 3. 字体:首选 Berkeley Mono,备选 IBM Plex Mono

用户选 Berkeley Mono。Berkeley Mono 是**付费字体**(商用 license 个人 ~$75 / 工作站 ~$200),无法在没核实授权的情况下擅自嵌入 Web。

**Plan:** design doc 同时记录两套字体,实施 Task 1 时先验证 license。如果 license 不可商用 / 不便获取,fallback 到 **IBM Plex Mono**(SIL OFL,免费商用)或 **JetBrains Mono**(OFL 1.1)。三者在 monospace 风格上接近,terminal 美学差异微小,fallback 不会破坏视觉走向。

**CSS font-family stack:**
```css
font-family: 'Berkeley Mono', 'IBM Plex Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
```

### 4. 调色板:6 色单色调

| token | value | 用途 |
|---|---|---|
| `--ghc-term-bg` | `#0d0d0d` | 终端框背景 |
| `--ghc-term-fg` | `#e8e8e8` | 默认文字 |
| `--ghc-term-dim` | `#888888` | "never" / 未使用 / 次要元数据 |
| `--ghc-term-ok` | `#00ff88` | active 状态点 / progress bar filled / 成功 toast |
| `--ghc-term-warn` | `#ffaa00` | disabled 状态点 / quota warning / in-pool-but-pending |
| `--ghc-term-info` | `#00aaff` | focus ring / `[t]` 测试按钮文字 |
| `--ghc-term-border` | `#444444` | 终端框外框 / 行分隔线 |

**不引入** 多色 accent(避免 terminal 主题常见的"霓虹堆叠");不引入 dark mode 切换(单一定制主题,与其他 admin 页保持浅色不冲突)。

**拒绝 cream + terracotta / SaaS card 通用模板**(参考 frontend-design skill 警告):用户已选 terminal 风格,这就是设计走向,不存在"通用默认"风险。

### 5. 列表:从 AdminTable 改为自渲染的 "列式 shell"

原 page.tsx 用 `<AdminTable columns={columns} rows={tokens}>`,列定义是函数式 `render: (tok) => <code className="ghc-admin-mono">{tok.tokenFirst4}…{tok.tokenLast4}</code>`。terminal 风格需要每行一个**对齐的"模拟终端记录"**(`● STATUS  label  prefix  used/limit  last` + 行内 `[t][E][x]`),这跟 AdminTable 抽象的 `header / rows / columns` 模型不吻合。

**Ruling:** 在 page.tsx 里**手渲染** 列表(不再用 AdminTable)。继续用 `AdminStatusChip` 渲染 status / pool 这两个 chip 是 OK 的(用户没反对 chip,只反对"简陋";chip 在 terminal 配色下可以承载状态语义)。

**Ruling:** lastError 列**继续** 显示 em-dash。schema 已有 `lastError` 字段(`prisma/schema.prisma:276` + `:415`),但 `listAllTokens` 的 select 字段未包含它。**这超出当前 spec 范围**,挂为 out-of-scope finding,留给后续任务。

### 6. 删除确认:内嵌 `$ confirm delete? [y/N]` 替换原生 confirm()

`token-actions.tsx:47` 当前是 `confirm(t('confirmDelete'))`。原生 confirm 在 terminal 主题里特别违和(浏览器默认白底 dialog 弹在深色 terminal 上)。改为:

- 用户点 `[x]` 后,`TokenActions` 内部 state 切到 `confirming: true`,行内显示 `$ confirm delete "<label>"? [y/N]`,两个 inline 按钮:`[y]` `yes, delete` / `[N]` `cancel`。
- 默认焦点 `[N]`(防误触)。
- 5 秒无操作 → 自动 cancel(`setTimeout` cleanup)。

**a11y:** `role="alertdialog"`, `aria-labelledby` 指向 label 行,`aria-describedby` 指向描述行。键盘:Tab 在 `[y]/[N]` 之间切,Escape 等同 `[N]`。

**拒绝"保留 confirm() 但深色样式":** 浏览器原生 confirm 无法主题化,放弃。

### 7. 行内操作按钮:`[t] [E/d] [x]` 风格

按 `[key] label` 排版:

- `[t]` test → 蓝色(info) 边框,点击后变 `[…]` 在请求中,成功 → `[ok]`,失败 → `[fail]` 1.5s 后回 `[t]`
- `[E]` enable(disabled 时) / `[d]` disable(active 时) → 琥珀色(warn) 边框
- `[x]` delete → 红色边框(用 `#ff5555` 在 dim `#888888` 之上的对比仍 OK)

所有按钮 `min-width: 2.5rem` + 等宽字体 + 大写;hover 时 background 从 transparent 切到 `currentColor` + 12% opacity;focus 时显示 `--ghc-term-info` 2px outline。

### 8. AddTokenForm:大写 mono label + `>` 提示符

- label 行:`> LABEL` (大写 mono)
- token 行:`> TOKEN` (大写 mono)
- 输入框:无 border,底部 1px `--ghc-term-border` 下划线;focus 时底部变 `--ghc-term-info`
- submit 按钮:`[ register ]` 空格包裹,大写 mono,按 `[ submit ]` 短键风格(但不带真快捷键)
- 错误 / 成功显示:`! err <msg>` 红色 + `> ok <msg>` 绿色,各用 mono log 行风格,前缀不同
- 提交中:`[…] submitting`

### 9. Pagination:terminal 风格

`<AdminPagination>` 当前是浅色 `<button> prev</button> <span>1 of 1</span> <button>next >` 结构。覆盖样式让它在 terminal 框内仍工作:`[← prev]    page X of Y · N items    [next →]`,小写 + 等宽 + dim 色;禁用态用 `───` em-dash。

**Ruling:** 继续用 AdminPagination 组件,只覆写 CSS,不改组件源码(其他 admin 页也用同一个组件)。

### 10. Empty state:不是"无内容 + 一个空按钮"

空状态 = `$ ls tokens` + dim `no tokens found.` + dim `$ gh token create ...` + 内嵌的 add token 表单(同 AddTokenForm,但放在框内)。

**Ruling:** 复用 `AddTokenForm` 组件,不另写 `EmptyStateForm`。Empty state 跟有数据时共用 add 区块,降低代码重复。

### 11. 测试策略

- 单元:`tests/unit/admin-github-tokens-empty.test.tsx`(新增)— 验证 0 token 时 page 渲染含 `$ no tokens found.` 文案 + AddTokenForm
- 单元:`tests/unit/admin-github-tokens-rows.test.tsx`(新增)— 验证 N token 时每行渲染含 `[t][E/d][x]` 按钮 + status dot
- 单元:`tests/unit/admin-github-tokens-confirm.test.tsx`(新增)— 验证点 `[x]` 后显示 `[y]/[N]` 内嵌确认,Escape 等同 `[N]`,5s 自动 cancel
- i18n:继续依赖 `tests/unit/i18n-coverage.test.ts` 强制 en/zh 同步;新增的 key 必须双侧都有
- 现有 `tests/unit/admin-github-tokens-i18n.test.tsx`(若有)需更新断言匹配新文案(若变更)
- 视觉验证:`npm run dev:server`,浏览器开 `/admin/github-tokens`,0/N/Many token 三态分别截图;键盘 tab 路径走一遍

### 12. 不做 (scope)

- 不改 schema(`lastError` 字段已存在但 select 未包含 — out of scope,留 follow-up)
- 不动 AdminShell / AdminSidebar / AdminTable 内部样式(只在 github-tokens 局部覆写)
- 不引入 dark mode 切换
- 不引入新字体 license(若 Berkeley Mono 不可商用,直接 fallback 到 IBM Plex Mono)
- 不改 batch enqueue / scheduler / pool(纯 UI 重设计)
- 不改 GitHub API 调用或 token 加密策略
- 不改 `/admin/github-tokens/[id]` 详情页(若存在) — 单独 spec

## 主要设计变更

### Palette tokens (新增 CSS custom properties)

```css
/* src/app/globals.css (新增 block, scoped via .ghc-term-* 类) */
.ghc-term-frame {
  --ghc-term-bg: #0d0d0d;
  --ghc-term-fg: #e8e8e8;
  --ghc-term-dim: #888888;
  --ghc-term-ok: #00ff88;
  --ghc-term-warn: #ffaa00;
  --ghc-term-info: #00aaff;
  --ghc-term-border: #444444;
  --ghc-term-err: #ff5555;

  background: var(--ghc-term-bg);
  color: var(--ghc-term-fg);
  font-family: 'Berkeley Mono', 'IBM Plex Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  border: 1px solid var(--ghc-term-border);
  border-radius: 0;        /* terminal 不需要圆角 */
  padding: 1.25rem 1.5rem;
}
```

### Files modified (3)

- `src/app/admin/github-tokens/page.tsx` — 替换 AdminTable 渲染为自渲染的列式 shell;保留 AdminPageHeader 在外;保留 pool quota warning(套 terminal 配色)
- `src/app/admin/github-tokens/_components/add-token-form.tsx` — 重写:大写 label、`>` 提示符、单色下划线输入框、`[ register ]` 按钮、`! err` / `> ok` 反馈行
- `src/app/admin/github-tokens/_components/token-actions.tsx` — 重写:`[t][E/d][x]` 单字符键按钮 + 内嵌 `[y/N]` 删除确认

### Files created (4)

- `src/app/admin/github-tokens/_components/terminal-frame.tsx` — 终端框容器组件(渲染外框 + 顶部标题栏 `$ github.tokens · N`)
- `src/app/admin/github-tokens/_components/token-row.tsx` — 单个 token 行的终端记录渲染
- `src/app/admin/github-tokens/_components/terminal-pagination.tsx` — 覆盖样式后的 pagination(包装 AdminPagination)
- `src/app/admin/github-tokens/_components/terminal-empty-state.tsx` — 空状态 + 嵌入式 AddTokenForm

### Files NOT touched (重要)

- `src/app/admin/_components/admin-page-header.tsx` — AdminPageHeader 不动
- `src/app/admin/_components/admin-table.tsx` — AdminTable 不动(github-tokens 不再用它)
- `src/app/admin/_components/admin-pagination.tsx` — AdminPagination 不动(只覆写 CSS)
- `src/app/admin/_components/admin-status-chip.tsx` — AdminStatusChip 不动(传 variant='ok'/'warn' 即可)
- `src/app/admin/_components/admin-shell.tsx` — AdminShell 不动
- `src/app/admin/_components/admin-sidebar.tsx` — AdminSidebar 不动
- `messages/en.json` + `messages/zh.json` — 只在 i18n-coverage 测试要求时新增 key(避免无关改动)

### 数据流(不变)

页面数据加载逻辑保持原样:
1. `requireAdmin()` — 鉴权
2. `listAllTokens({ skip, take })` — 取当前页
3. 二次 `listAllTokens({ skip: 0, take: PAGE_SIZE_MAX })` 仅用于 quota totals
4. `poolHasId(tok.id)` — in-memory pool 查询(逐行调用)

**Ruling:** 二次 listAllTokens 是已有的小性能问题(M11.10 时代的设计,quotaPct 计算需要全表聚合),不在本次 scope。挂为 follow-up,标记 M33。

## 数据流(组件层级)

```
page.tsx (server component)
  ├── AdminPageHeader         (浅色,在外)
  ├── .ghc-term-frame
  │   ├── $ github.tokens · N (标题栏)
  │   ├── > pool  ████░░ 76%  (quota summary)
  │   ├── [optional quota warning bar]
  │   ├── > registered        (小标题)
  │   ├── <TokenRow /> × N    (每行终端记录)
  │   ├── [optional <TerminalEmptyState /> if N==0]
  │   ├── > add new           (小标题)
  │   ├── <AddTokenForm />
  │   └── <TerminalPagination /> (包装 AdminPagination)
```

`TokenRow` 内部挂 `<TokenActions />`,后者管 `[t][E/d][x]` + 删除确认状态。

## 风险

### 1. Berkeley Mono 商用授权

无法在写 spec 时核实 license。**Mitigation:** Task 1 先验证;不可商用直接换 IBM Plex Mono,视觉差异小,fallback 安全。CSS font-family stack 已经按 fallback 顺序排好。

### 2. 行内 `[y/N]` 5s 自动 cancel 的 timer 清理

React 19 useEffect 内 setState 需要包 setTimeout(0) 或 useSyncExternalStore(见 CLAUDE.md "React 19 effect rule")。`TokenActions` 已有 setBusy / setMessage state,加 `confirming` state + setTimeout 走同一套。

**Ruling:** 用 `useRef<number | null>` 存 timer id,unmount 时 `clearTimeout`。`confirming=false` 时也清旧 timer(防双 timer 竞态)。

### 3. Terminal 框 + AdminPagination 默认浅色样式冲突

`AdminPagination` 用 `ghc-btn-secondary` 等浅色样式 class,在深色 terminal 框内颜色对比可能不够。**Mitigation:** 通过 `:where(.ghc-term-frame) .ghc-btn-secondary` 或类似 scoped override 重设 bg/fg。Test 覆盖:N token 时点 next,terminal pagination 按钮可见且对 dark bg 有足够对比。

### 4. `[t]` test 按钮成功 / 失败状态切换时的视觉残留

`AdminTokenTestButton` 是现有组件,内部状态机未知。**Mitigation:** Task 实现时先读源码确认 API。如果组件自带成功 / 失败视觉,在 terminal 主题下可能被原样式覆盖(浅色 ok / fail chip)。**Plan:** Task 4 实施时如冲突,把 AdminTokenTestButton 替换为 terminal 风格本地版本(只在此页生效)。

### 5. 与现有浅色 admin 页面的"亮→暗→亮"跳变

用户接受此取舍。文档化的副作用,不在技术风险列表 — 是显式的设计选择。

## 测试

### Unit (新增 3 个)

```ts
// tests/unit/admin-github-tokens-empty.test.tsx
test('renders empty state with $ no tokens found and embedded AddTokenForm', async () => {
  // 0 tokens → 终端框标题 "github.tokens · 0"
  // > pool 行存在(quota 0/0)
  // $ no tokens found. 行存在
  // AddTokenForm 存在
});

// tests/unit/admin-github-tokens-rows.test.tsx
test('renders N token rows with status dot + [t][E/d][x] buttons', async () => {
  // 3 tokens → 3 行,每行含 ●/○ 状态点
  // 每行含 [t] (test) [x] (delete) + active→[d] 或 disabled→[E]
});

// tests/unit/admin-github-tokens-confirm.test.tsx
test('clicking [x] shows inline [y/N] confirm; Escape cancels; 5s timeout cancels', async () => {
  // click [x] → 显示 "$ confirm delete "<label>"? [y/N]"
  // press Escape → confirming=false,无 API 调用
  // vi.useFakeTimers() + advance 5000ms → confirming 自动 false
});
```

### Integration (不新增)

现有 `tests/integration/admin-github-tokens-route.test.ts`(若有)只测数据流,不碰样式,保持不动。

### i18n

`tests/unit/i18n-coverage.test.ts` 强制 en/zh 同步;所有新 key 双侧添加。

### Verification commands

```bash
npm run typecheck   # strict,期望 0 errors
npm run lint        # 0 errors
npm test            # 全部 + 3 个新 unit
npm run dev:server  # 起服务,浏览器开 /admin/github-tokens
```

### Browser checks (人工)

- 0 token 状态:终端框 + empty + 嵌入式 add form
- 1 token 状态:terminal 框 + 1 行 + add form
- N>10 token 状态:terminal 框 + 表格 + pagination(逐页切换)
- 点 `[x]` → 内嵌确认 → 按 `[N]` 取消 → 无网络请求
- 点 `[x]` → 内嵌确认 → 5 秒不动 → 自动取消
- 点 `[x]` → 内嵌确认 → 按 `[y]` → 实际删除
- 键盘 Tab 路径:focus ring 可见,顺序合理
- 浅色 AdminShell 跳到深色 github-tokens 页再返回其他页:确认只有一次"亮→暗→亮"跳变,无样式残留

## 不做什么 (scope)

- 不修 listAllTokens 二次全表拉(M33 follow-up)
- 不补 lastError 字段到 listAllTokens select(M33 follow-up)
- 不改 AdminShell 全局深色
- 不引入 adminVariant 切换
- 不引入 Berkeley Mono license 采购流程(不可商用就 fallback)
- 不改 /admin/github-tokens/[id] 详情页(若存在)
- 不改 batch enqueue / pool / scheduler 任何逻辑
- 不改 webhook 投递逻辑
- 不改 GitHub token 加密存储策略
- 不改 `/admin/api-settings` 表单(已独立)