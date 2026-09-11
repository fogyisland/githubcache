# 公开页视觉重设计（M29）

**状态**: 待审阅
**日期**: 2026-09-10
**范围**: 仅公开页（~14 页），不含 admin 后台（32 页，DEFER 到下个 spec）

---

## 1. 背景与目标

`githubcache` M24 引入的 Wulan 调色板奠定了视觉骨架，但**公开页**仍存在三方面问题：

1. **主题分裂**：3 个主题（`terminal` / `editorial` / `brutalist`）给访客造成选择疲劳；`terminal` 是默认但语义上不贴「专业服务」定位。
2. **色调偏跳**：默认 accent 是 sky blue `#4a90e2`，与其他灰度搭配对比生硬，与 Linear / Vercel / Stripe Dashboard 家族的克制专业感有差距。
3. **首页信息密度高但层次弱**：当前 hero 用渐变背景 + 多 chip 标签压满首屏，缺少呼吸感；访客无法在 3 秒内回答「这是做什么的 / 怎么用 / 为什么用」。

**核心原则**: 视觉层重做，**不动** API 契约、不动 schema、不引入新依赖。Server Components 优先。

**具体目标**:
- **风格基调**：克制专业风（Linear / Vercel / Stripe Dashboard 家族），低饱和度中性灰 + 单一 accent
- **主题架构**：保留 3 主题代码块（向后兼容），把默认 `terminal` → 重命名为 `professional`；新增 `professional-dark` 作为 cookie 受控的暗色变体
- **Accent 颜色**：Indigo `#4f46e5`（替换 sky blue `#4a90e2`），应用到 `--color-accent` / `--color-accent-deep` / `--color-accent-soft`
- **首页**：打掉重盖，按「价值主张 → 工具入口 → 数据证明 → 入门引导」4 段重排
- **质量维度**（4 项全部满足）：交互反馈 / 性能 / 响应式 / a11y

**明确不做**:
- Admin 32 页视觉重做（DEFER 到下个 spec）
- 25 个 mutating admin route 缺 role check（M28 选项 C 单独 spec）
- 删除 `editorial` / `brutalist` 主题块（保留兼容，避免连锁改动）
- 新增 npm 依赖（CLAUDE.md 禁止）
- API 契约 / Prisma schema 改动
- Tailwind 4 → Tailwind 5 / 换设计系统

---

## 2. 设计 Token 调整

### 2.1 调色板（低饱和度中性灰 + indigo accent）

| Token | 现值 | 新值 | 说明 |
|---|---|---|---|
| `--color-bg` | `#fafbfc` | `#fbfbfa` | 偏暖的近白底色，弱化冷感 |
| `--color-surface` | `#ffffff` | `#ffffff` | 卡片表面，纯白 |
| `--color-surface-2` | `#f5f8fa` | `#f7f7f5` | 次级表面（hover / 表格条纹） |
| `--color-ink` | `#1a2b4a` | `#18181b` | 主文本，zinc-900 |
| `--color-ink-muted` | `#6b7b95` | `#71717a` | 辅助文本，zinc-500 |
| `--color-rule` | `#dde4ec` | `#e4e4e7` | 分隔线，zinc-200 |
| `--color-accent` | `#4a90e2` | `#4f46e5` | **主 accent**，indigo-600 |
| `--color-accent-deep` | `#2c5f8e` | `#4338ca` | accent hover/active，indigo-700 |
| `--color-accent-soft` | `#e6f1fa` | `#eef2ff` | accent 浅底（chip / badge），indigo-50 |
| `--color-warn` | `#c08a2a` | `#b45309` | amber-700 |
| `--color-danger` | `#b73e3e` | `#b91c1c` | red-700 |

**`professional-dark` 变体**（cookie 受控）：

| Token | dark 值 | 说明 |
|---|---|---|
| `--color-bg` | `#09090b` | zinc-950 |
| `--color-surface` | `#18181b` | zinc-900 |
| `--color-surface-2` | `#27272a` | zinc-800 |
| `--color-ink` | `#fafafa` | zinc-50 |
| `--color-ink-muted` | `#a1a1aa` | zinc-400 |
| `--color-rule` | `#27272a` | zinc-800 |
| `--color-accent` | `#818cf8` | indigo-400（暗色下提高亮度保对比度） |
| `--color-accent-deep` | `#6366f1` | indigo-500 |
| `--color-accent-soft` | `#1e1b4b` | indigo-950 |

`editorial` / `brutalist` 主题块**不重做**，仅跟着 `professional` 改 3 个 accent token 保持色调一致（可选，若不改也不影响功能）。

### 2.2 字体策略

**保留全部 5 个 next/font**（CLAUDE.md 禁止新增）：
- `JetBrains Mono`（数字 / 代码）
- `IBM Plex Sans`（正文，`professional` 主题默认）
- `IBM Plex Mono`（代码块 / monospace 段落）
- `Fraunces`（`editorial` 主题标题 serif）
- `Space Grotesk`（`brutalist` 主题标题）

**`professional` 主题字号体系**（rem 基准 16px）：

| Token | size | line-height | weight | 用途 |
|---|---|---|---|---|
| `display-xl` | `3.5rem` | 1.05 | 700 | 首页 h1 |
| `display-lg` | `2.5rem` | 1.1 | 700 | 页内 h1 |
| `display-md` | `1.875rem` | 1.2 | 600 | h2 |
| `display-sm` | `1.5rem` | 1.3 | 600 | h3 |
| `body-lg` | `1.125rem` | 1.6 | 400 | 引导文案 |
| `body` | `1rem` | 1.6 | 400 | 正文 |
| `caption` | `0.875rem` | 1.5 | 400 | 辅助说明 |
| `eyebrow` | `0.75rem` | 1.4 | 500 | tag / label（uppercase tracking 0.06em） |

### 2.3 间距 / 圆角 / 阴影

- **间距**：8px 基准（4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96）
- **section 间距**：`clamp(3, 6vw, 5)rem`
- **圆角**：卡片 6px / 按钮 4px / pill 999px
- **阴影**：
  - 默认卡片：`0 1px 2px rgba(0,0,0,.04)`
  - hover 卡片：`0 4px 12px rgba(0,0,0,.06)`
  - 对话框：`0 10px 30px rgba(0,0,0,.12)`

### 2.4 微动效预算

- 入场：`fade-up 280ms ease-out`（已存在的 `ghc-fade-up`）
- hover：`120ms ease-out`（背景 / 边框 / 1px translateY）
- shimmer：`1400ms`（loading skeleton，`ghc-shimmer` 已存在）
- cursor blink：`1.1s`（仅 lookup 输入框提示）
- **prefers-reduced-motion**：已全局包裹，全部降级为 `animation: none`

---

## 3. 公开页设计

### 3.1 Site Header（每个页面顶部 chrome）

**布局**：

```
┌────────────────────────────────────────────────────────────────┐
│ [logo]   Lookup  Docs  Status       [TZ▾] [ZH/EN]  [Login] [☰] │
└────────────────────────────────────────────────────────────────┘
```

- **左**：logo（小尺寸 svg + 文字 "githubcache"，高 28px）
- **中**：nav links（Lookup / Docs / Status）— 仅 3 个
- **右**：
  - TZ select（缩小版 `ghc-tz-select`）
  - Lang switcher（ZH / EN 双 pill，保留 `ghc-lang-row`）
  - 登录用户：avatar + email 缩写 → 点击展开菜单（API keys / 账号设置 / 注销）
  - 未登录：[Login] 按钮（`ghc-btn-secondary`）
  - **移除**：theme switcher（3 pill）
- **移动端 (< 640px)**：折叠为汉堡菜单 `☰`，点击展开抽屉式 nav

**改动**：
- 删除 `src/app/_components/theme-switcher.tsx`
- 新增 `src/app/_components/mobile-nav.tsx`
- 新增 `src/app/_components/account-menu.tsx`
- `<SiteHeader>` 重写为新布局

### 3.2 Site Footer

**布局**：

```
┌────────────────────────────────────────────────────────────────┐
│  githubcache                                       Lookup        │
│  Cached GitHub metadata.            Docs                        │
│  No token, no rate limit.           Status                      │
│                                    Account                     │
│  ──────────────────────────────────────────────────────────── │
│  © 2026 githubcache    MIT    v0.1.0    [GH]  [API status: ●] │
└────────────────────────────────────────────────────────────────┘
```

- **左**（2fr）：logo + tagline + 1 句描述
- **右**（1fr）：3-4 个 nav links
- **底**：copyright + license + version + 外部 GitHub link + API status dot（绿 / 红实时）

**改动**：
- `ghc-site-footer` 样式微调：去圆角、阴影，加底部 hairline
- 集成 live status（调 `/api/v1/status` 的 ping 子集）

### 3.3 首页 `/`（打掉重盖）

**新结构**（垂直 stack，section 之间 `--space-section`）：

```
┌─────────────────────────────────────────────────────────────┐
│  [Hero]                                                      │
│  eyebrow: "GITHUB METADATA · CACHED · FREE"                  │
│  h1:     GitHub repo data, fetched once.                     │
│  p:      Submit any repo — get stars, forks, language,      │
│          license, topics, dates. Cached for 6 hours.         │
│          No GitHub token required.                           │
│                                                              │
│  ┌──────────────────────────────────────────────┐ [Lookup →] │
│  │ owner/repo                                    │           │
│  └──────────────────────────────────────────────┘           │
│                                                              │
│  Try: facebook/react · microsoft/typescript · …              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  [Stats strip]  Repos · Lookups 24h · Cache hit rate · Uptime│
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  [Features — 3-up]                                           │
│  ● Instant     ● Cached       ● Rate-limited                 │
│  <inline SVG>  <inline SVG>   <inline SVG>                   │
│  First lookups  6h TTL with   Per-IP limit, no               │
│  hit GitHub     auto-refresh   token needed                  │
│  directly       on stale rows                                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  [API preview — split panel]                                 │
│  Request                  │ Response                         │
│  $ curl ...               │ {                               │
│                           │   "owner": "facebook",          │
│                           │   "stars": 234567,             │
│                           │   ...                            │
│                           │ }                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  [Recent lookups]  (latest 8)                                │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                │
│  │ repo   │ │ repo   │ │ repo   │ │ repo   │                │
│  └────────┘ └────────┘ └────────┘ └────────┘                │
└─────────────────────────────────────────────────────────────┘

[Footer]
```

**Hero 视觉**：
- 背景：纯白（不沿用当前 `ghc-hero-gradient`，更克制）
- h1 用 `--text-display-xl`，字重 700，行高 1.05
- tagline 用 `--text-body`，颜色 `--color-ink-muted`
- lookup form 居中，最大宽度 640px
- "Try:" 行用 mono 字体小按钮，点击直接 fetch

**Stats strip**：
- 4 列等宽（移动端 2 列）
- 数字 1.5rem，用 `tabular-nums`
- hover 时整列底色微微变化

**Features**：
- `ghc-features-grid` 已存在，重做图标（linear 风格 SVG，1.5px stroke）
- 标题 `--text-display-sm`，正文 `--text-caption`
- hover 时 border 变 accent

**API preview**：
- 新组件 `ghc-api-split`，2 列等宽
- 左：`ghc-code-block`（curl 命令）
- 右：`ghc-code-block`（JSON 响应，syntax highlight 用 `lang-json` class）
- 移动端堆叠为 2 行

**Recent lookups**：
- 8 个卡片网格（4 列 desktop / 2 列 mobile）
- 每个卡片：repo 名（mono font） + stars 数字 + 缓存时间
- hover 时 1px translateY

### 3.4 其他公开页（汇总，详细设计在 plan 阶段展开）

共 12 个公开页 + chrome（site header / footer 在 §3.1 / §3.2）：

**通用原则**：
- 统一使用 `professional` 主题
- 复用 `ghc-*` 组件库（不引入新 class）
- 每页至少一个 h1（语义 + a11y）
- 表单用 `ghc-input` + `ghc-btn-primary`，错误用 `ghc-alert-danger`
- 数据加载用 `loading.tsx` skeleton（`ghc-shimmer`）

**逐页要点**：

| 页 | 关键调整 |
|---|---|
| `/login` | 居中卡片 max-width 400px；加 background 装饰（极淡网格或纯色）；表单错误用 `ghc-alert-danger`；submit button 禁用状态 + spinner |
| `/status` | 顶部 `ghc-status-banner`（已存在）；服务列表用 `ghc-table`；uptime 条形图（90 天）— **新增**小型条形图组件 |
| `/get-started` | 4 步卡片（横向 grid desktop / 纵向 stack mobile）；每步有 numbered badge + 简短描述 + curl 示例 |
| `/repo/[owner]/[name]` | hero 大字 owner/name（mono font）+ stars/forks 大数字；tabs（概览 / branches / releases）保留；API shape 折叠 `ghc-api-shape` 已存在 |
| `/account` | sidebar（保留 `ghc-account-sidebar-link`）+ 主区 layout |
| `/account/keys` | 表格（`ghc-table`）+ 创建按钮 + status filter pills |
| `/account/keys/[id]` | 双列布局：左 dl 元信息（`ghc-detail-dl`），右最近活动（`ghc-history-list`） |
| `/account/keys/request` | 居中表单 + hint text |
| `/account/password` | 简单表单 + 错误提示 |
| `/docs` | 6 张卡片 grid（API / 部署 / 开发）+ 简短描述 |
| `/docs/api/*` | 通用 layout：sidebar + 主区代码示例（curl / Python / JS）+ 响应示例 |
| `/init/*` | 顶部 progress bar（4 步）+ 当前步骤表单 + 上一步 / 下一步按钮 |

### 3.5 设计语言（cheat sheet）

| 元素 | 规范 |
|---|---|
| **字号** | h1=`display-xl`, h2=`display-lg`, h3=`display-md`, 正文=`body`, 辅助=`caption`, 标签=`eyebrow` |
| **字重** | 标题 700 / 600，正文 400，accent text 500 |
| **颜色** | 文本=`ink`，辅助=`ink-muted`，accent 链接 / 按钮 / focus / 边框高亮 |
| **圆角** | 卡片 6px，按钮 4px，pill 999px |
| **阴影** | 卡片 1px，浮层 4px，对话框 10px |
| **间距** | section 之间 `clamp(3, 6vw, 5)rem`；内部 stack `0.5 / 1 / 1.5 rem` |
| **动效** | 280ms fade-up 入场；120ms hover transition；stats 数字 count-up 600ms |

---

## 4. 性能 / a11y / 响应式（横切关注）

### 4.1 性能

- **LCP 目标**：首页 < 1.5s（lighthouse local build）
- **首屏 JS**：公开页保持 Server Components，首屏只发 h1 + form（< 30KB gzip）
- **图片**：保留 `next/image`，`logo` 用 SVG（< 2KB），repo avatars 用 `unoptimized={false}` + 远程 GitHub avatar
- **字体**：5 个 next/font 全部 `display: 'swap'`，避免 FOIT

### 4.2 a11y

- **对比度**：正文 ≥ 4.5:1（WCAG AA），大字号 ≥ 3:1；首选 AAA（≥ 7:1）正文
- **键盘可达**：所有交互元素 `:focus-visible` 显示 2px indigo ring（`--color-accent`）
- **语义**：每页 1 个 h1；表单 `<label htmlFor>` 关联；按钮有 `aria-label`（icon-only 时）
- **SR 提示**：live region（`role="status"`）用于 form submit、API status dot 变化
- **prefers-reduced-motion**：已全局包裹（`ghc-fade-up` / `ghc-shimmer` / `ghc-cursor-blink` 全部降级）

### 4.3 响应式

- **断点**：< 640px mobile / 640-1024px tablet / ≥ 1024px desktop
- **首页 hero**：移动端 padding `1rem`，h1 从 `3.5rem` 缩到 `2.25rem`
- **Stats strip**：移动端 2 列网格
- **Features**：移动端单列
- **API preview**：移动端 2 行堆叠（curl 在上，response 在下）
- **Recent lookups**：桌面 4 列 / 平板 2 列 / 手机 1 列（保持可读）
- **Site header**：≥ 1024px 完整 nav；< 1024px 折叠为汉堡菜单
- **Site footer**：≥ 1024px 2 列；< 1024px 单列

---

## 5. 实施分阶段 + 验收

### 5.1 阶段划分（4 个独立 commit）

| # | Commit 名 | 范围 | 验收门 |
|---|---|---|---|
| **1** | `chore(design-tokens): rename terminal→professional, add professional-dark, indigo accent` | `src/app/globals.css` + 删除 `src/app/_components/theme-switcher.tsx` + `src/lib/theme/cookie.ts` 加 `professional-dark` 值 | typecheck ≤ 26、vitest 无回归、手动切换主题可见 |
| **2** | `feat(homepage): 视觉重做首页 (Server Components, 5 section)` | `src/app/page.tsx` 重写 + 7 个子组件改造（hero / stats-bar / features / api-split / recent-lookups / quick-try / lookup-form） | LCP < 1.5s（lighthouse local）、键盘可达、移动端汉堡可点 |
| **3** | `feat(site-chrome): site-header + site-footer + mobile-nav + account-menu` | `src/app/_components/site-header.tsx` + `site-footer.tsx` 重写 + 2 新组件（`mobile-nav.tsx`、`account-menu.tsx`） | 登录/未登录态切换可见、移动端抽屉开合正常 |
| **4** | `feat(public-pages): 12 个公开页应用新设计语言` | login / status / get-started / repo/[owner]/[name] / account/* / docs/* / init/* | 全部用 `professional` 主题、无 `terminal` 字样残留在公开组件 |

### 5.2 验收门（每 commit 必跑）

```bash
npm run typecheck   # 错误数 ≤ 26 (baseline)
npm run lint        # 无新错（baseline 的 @rushstack/eslint-patch 报错不算）
npm test            # 无新失败（pre-existing ~59 failures 可继续失败）
```

**视觉烟测**（手动）：
- 桌面（≥1024px）、平板（640-1024px）、手机（<640px）三档各 1 次截图
- 键盘 Tab：能从 logo 走到 footer，无 focus ring 缺失
- `prefers-reduced-motion`：开 OS 设置 → 应无 fade-up、无 shimmer
- 对比度：WebAIM contrast checker 抽查首页 hero / footer / button 三处

**回归保护**：
- 不动 API 路由（`/api/v1/*`、`/api/admin/*`、`/api/query/*`）
- 不动 `prisma/schema.prisma`、`prisma/migrations/*`
- 不动 `messages/{en,zh}.json` 现有 key（只新增，不删改）

### 5.3 Out of scope（明确排除）

| 项 | 原因 |
|---|---|
| Admin 32 页视觉重做 | DEFER 到下个 spec |
| 25 个 mutating admin route 缺 role check | M28 选项 C 单独 spec |
| 新增 npm 依赖 | CLAUDE.md 明确禁止 |
| Tailwind 4 → Tailwind 5 / 换设计系统 | 保持现状 refactor |
| 删除 `editorial` / `brutalist` 主题 | 保留兼容 |
| 移除其他 2 个主题的代码路径 | 保留兼容，避免连锁改动 |

### 5.4 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 重命名主题后旧 cookie 用户看到默认主题闪烁 | 中 | 主题 cookie 设 `defaultValue = 'professional'`；`src/lib/theme/cookie.ts` 读取逻辑要 fallback |
| `professional-dark` 缺少字体对照组合 | 低 | 仅换色（surface / ink / rule），保留现有 5 字体 |
| `ghc-*` 类名重命名破坏太多现有引用 | 中 | 本 spec **只重命名主题值**（`terminal` → `professional`），class 名不动 |
| Admin 内部还在用 `terminal` 字样 | 低 | Admin 在阶段 1 后已迁移 32 页中的大部分；剩余若有，admin 重做 spec 处理 |

### 5.5 文档与记录

- 每 commit 后更新 `progress.md`（沿用 M28 格式）记录：
  - 改了什么、为什么、baseline 对比
  - reviewer verdict（spec compliance + code quality）
- 阶段 1 完成后，更新 memory file `project_public_pages_redesign_direction.md` 增加「implementation status」一节

---

## 6. 关键文件清单

**新建**：
- `src/app/_components/mobile-nav.tsx`
- `src/app/_components/account-menu.tsx`
- `src/app/_components/uptime-bars.tsx`（`/status` 用）

**重写**：
- `src/app/globals.css`（token 调整）
- `src/app/page.tsx`（首页打掉重盖）
- `src/app/_components/site-header.tsx`
- `src/app/_components/site-footer.tsx`
- `src/app/_components/hero-section.tsx`（从 `page.tsx` 抽出）
- `src/app/_components/stats-bar.tsx`
- `src/app/_components/features-section.tsx`
- `src/app/_components/api-split.tsx`
- `src/app/_components/recent-lookups-list.tsx`

**修改**（轻量）：
- `src/lib/theme/cookie.ts`（加 `professional-dark` 值）
- 13 个公开页（按 §3.4 表）

**删除**：
- `src/app/_components/theme-switcher.tsx`

**文档**：
- `docs/superpowers/specs/2026-09-10-public-pages-redesign-design.md`（本文件）
- `docs/superpowers/plans/2026-09-10-public-pages-redesign.md`（实施 plan，下一步产出）
- `.superpowers/sdd/2026-09-10-public-pages-redesign/progress.md`（SDD ledger）

---

**审阅者请关注**：
1. §2.1 调色板是否符合「克制专业风」基调？
2. §3.1 site-header 移除 theme switcher 是否合理？
3. §3.3 首页 5 段结构是否过度？
4. §5.1 4 个 commit 划分是否合理？
5. §5.3 out of scope 是否有遗漏？