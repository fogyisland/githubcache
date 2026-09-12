# M31 — No-Stub Pending Semantics — 设计

**Status:** draft (待审阅)
**Author:** Claude (controller)
**Date:** 2026-09-13
**Predecessor:** M30.7c cache-miss ETA (shipped `2026-09-12`)、M30.7b flat-column regression fix (`f2e7f19`)、M27.4 upsertRepo UPDATE path fix

## 背景

Pre-M31 的缓存流程里,`lookup.ts:enqueueRefresh` 在 cache-miss 时会**同步**执行 `prisma.repository.upsert(...)`,立刻写入一条 `Repository` 行:

- `fetchStatus: 'ok'`
- 所有 flat 列(stars / forks / openIssues / pushedAt 等)都是零值
- 关联的 `node` 记录是 `stub: true` 占位

这样做的副作用是 `/admin/repositories`(俗称"已入库节点"页面)会出现 GitHub 实际上从来没返回过数据的 0-star / 0-fork 行。用户明确要求:**只有 GitHub 真正返回过 200 / 304 的 repo 才算"已入库"**。Pending 的工作流不应该产生可见的 `Repository` 行。

这个 stub-row 概念是从最早期的 cache flow 遗留下来的(M3 时期为了让"刚被请求的 repo 立刻出现在 admin 列表里")。到了 M30.7 / M30.7b 时,这个设计已经开始踩坑:

- M30.7b 修过 `upsertRepo` 的 UPDATE path 漏写 flat column 的 bug,但根因是 stub row 的存在让"UPDATE 写零值"和"INSERT 写真实值"看起来不可区分。
- `refresh-one.ts` 的 404 / 410 路径曾经通过 `storeRepoMetadata` 写一行 `fetchStatus: 'not_found'` 的 repo。这让"已入库"的语义被稀释。
- Provider-run 的批量路径(`/api/admin/providers/[id]/run`)也依赖 stub-row 概念 — 批量提交 N 个 owner/name,worker 一个个去 GitHub 拉,中间态全是 stub。

M31 的核心:把"pending 工作流"和"已入库"两个语义彻底切开。前者只走 `refresh_jobs` + audit log,后者只在 GitHub 真的确认 repo 存在之后才落表。

## 目标

1. `/admin/repositories` 只展示 GitHub 真实确认过的 repo 行(`fetch_status: 'ok'`)。Pending / not_found / forbidden 都不在这里出现。
2. Cache-miss `GET /api/v1/repos/[owner]/[name]` 仍然返回 200 + `fetch_status='pending'` + ETA(M30.7c 保留行为不变)。
3. GitHub 返回 404 / 410 / 403 时,`repositories` 表完全不动 — 只写 `refresh_jobs.attempts++` 和 audit log。
4. Provider bulk-run 路径删除。每个 owner/name 必须通过公开 lookup API 单独排队(模板 `test/load-50.mjs` 提供)。
5. `RefreshJob` 的 `repositoryId` 改成 nullable + 新增 `owner` / `name` 列作为 source of truth。FK 删掉。
6. `storeRepoMetadata` 从单 `upsert` 拆成 `findRepoByCanonical → branch → createRepo | updateRepo`,消除 M30.7b 类的"UPDATE 路径默默吃掉列"的回归风险。

## 关键决策

### 1. Stub-row 在 lookup 层移除,不在 worker 层

`lookup.ts:enqueueRefresh` 不再 `prisma.repository.upsert(...)`。替代方案是保留 stub,但标记 `fetchStatus: 'pending'`,让 `refresh-one.ts` 在 worker 里 overwrite。

**拒绝保留方案的原因:** stub row 会泄漏工作流中间态到 admin UI。即使 `fetchStatus` 字段语义清晰(`/admin/repositories` 可以过滤掉),其它 admin 视图(比如 `admin-job-card-grid.tsx`、queue 页面的 pending 计数)也都隐式假设"有 Repository 行 ≠ 已确认",需要逐处加防御。移到 lookup 层彻底切断耦合:pending 永远不在 `repositories` 表里。

**取舍:** lookup 层多一次 `prisma.refreshJob.upsert` (P2002 已处理),少一次 `prisma.repository.upsert`。整体写入次数不变,但失败语义更干净(刷新失败的 repo 不会有"半成品"行)。

### 2. `RefreshJob.repositoryId` 改 nullable + 加 `owner` / `name` 列

原 schema 里 `repositoryId BigInt NOT NULL` + FK to `Repository`。改成 `repositoryId BigInt?` + 新增 `owner String @db.VarChar(100)` + `name String @db.VarChar(200)`,FK 删掉。

`owner` / `name` 成为 source of truth;`repositoryId` 只是一个 denormalized hint,pending job 是 `null`,worker 跑成功后回填。

迁移是 3-step SQL:
1. `ALTER TABLE refresh_jobs ADD COLUMN owner VARCHAR(100), ADD COLUMN name VARCHAR(200);`
2. `UPDATE refresh_jobs rj JOIN repositories repo ON rj.repository_id = repo.id SET rj.owner = repo.owner, rj.name = repo.name;`
3. 检查 step 2 受影响行数 == refresh_jobs 总行数(orphan detection);确认后 `ALTER TABLE refresh_jobs DROP FOREIGN KEY ... , DROP COLUMN repository_id, ADD COLUMN repository_id BIGINT NULL;`

**拒绝"保留 FK + 双写"的方案:** 双写让 owner/name 和 repository.owner/name 永远有可能 drift(M30.7b 的同类问题)。直接砍 FK 让 `RefreshJob` 自治。

### 3. `storeRepoMetadata` 拆成 find → branch → write

原来是单个 `prisma.repository.upsert({ where: { owner_name }, update, create })`。M30.7b 已经证明 `update` 路径会和 `create` 路径写出不一致的列集合(UPDATE 漏写 flat column)。

M31 改成显式分支:

```ts
async function storeRepoMetadata(baseData: RepoBaseData) {
  const existing = await findRepoByCanonical(baseData.owner, baseData.name);
  if (existing) {
    return updateRepo({ id: existing.id, data: baseData });
  }
  return createRepo(baseData);
}
```

`findRepoByCanonical` 用 `@@unique([owner, name])` 索引,O(1)。`createRepo` 和 `updateRepo` 是两个独立 Prisma 调用,各自带完整列集合。

**仍存在的 race:** 两个 worker 同时 `findRepoByCanonical → null → createRepo`,后写的人拿 P2002 unique violation。prisma layer 不 catch,会冒泡到 `refresh-one.ts` 的 error handler。M31 不修这个 — 标记为 M32。当前实践中 `claimBatch` 已经通过 `lockedUntil` 做 per-job lease,同一 (owner, name) 不太会同时进 claimBatch(因为 `RefreshJob` 的 `@@unique([owner, name])` 索引在 enqueue 阶段就保证了),但 scheduler 重启瞬间可能有竞态。

### 4. 失败路径只写 audit log,不写 `repositories`

`refresh-one.ts` 的 404 / 410 / 403 分支:

- **404 / 410:** `refreshJob.update({ status: 'pending', attempts++, lastError: 'not_found' | 'gone' })` + audit `refresh.failed_review` with `targetId = '${owner}/${name}'` + `scheduledFor = now + 24h`(M30 行为不变)。**不**调用 `storeRepoMetadata`。
- **403:** `refreshJob.update({ status: 'failed', attempts++, lastError: 'forbidden' })` + audit `repo_forbidden` with `targetId = '${owner}/${name}'`。**不**调用 `storeRepoMetadata`,**不**再重试(M30 行为不变)。

audit log metadata 删掉 `repoId` 字段(stub row 不存在,没东西可指);`targetId` 用 `'${owner}/${name}'` 作为稳定标识。

**关键变化:** 失败 repo 在 `repositories` 表里**永远不存在**。操作员要查失败原因,只能去 `/admin/audit` 搜 `repo_forbidden` 或 `refresh.failed_review`。这是 `/admin/repositories` filter chip 被删除的根本原因(决策 6)。

### 5. Provider-run 移除,preview 保留

`/api/admin/providers/[id]/run` (POST) 路由删除。`/api/admin/providers/[id]/preview` (GET) 保留。

Provider admin UI 的 "Run" 按钮去掉,只剩 CRUD + Preview。批量预热(repo warming)改成公开 lookup API 循环调用 — 提供 `test/load-50.mjs` 模板(50 个 repo 并发拉、排队、drain、二次拉)。

**拒绝"保留 run 但改成异步任务"的方案:** 批量调度本质上是 lookup API 的 N 次调用,用调度器绕过去重复发明轮子,而且会让 provider 这层抽象继续承载"批量提交"语义。砍掉让 provider 回归"数据源定义"的纯粹角色。

### 6. `/admin/repositories` 4-way filter chip 删除

原 filter chip 是 `ok / not_found / forbidden / error` 四选一。M31 之后,`repositories` 表里只剩 `ok` 行(其它状态根本不写表),filter chip 没意义。

**`?status=...` URL param silently ignored** — 老的 `?status=not_found` URL 现在会展示全部 ok 行(因为没东西被过滤)。可接受因为:

- 老 URL 主要来自历史 bookmark,数量小。
- Audit log search 是新常态,filter chip 用户会自然迁移过去。

## 主要设计变更

### Schema

```prisma
model RefreshJob {
  id           BigInt  @id @default(autoincrement())
  repositoryId BigInt?            // was: BigInt (FK NOT NULL)
  owner        String  @db.VarChar(100)
  name         String  @db.VarChar(200)
  status       String
  priority     Int     @default(50)
  attempts     Int     @default(0)
  scheduledFor DateTime
  lastError    String? @db.Text
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([owner, name])
  @@map("refresh_jobs")
}

model Repository {
  // unchanged shape
  // RefreshJob reverse-relation removed (no longer has repositoryId FK)
}
```

Migration 文件: `prisma/migrations/20260913000000_no_stub_pending/migration.sql` — 3-step SQL(add nullable cols → backfill from FK join → drop FK + recreate as nullable)。

### Code

- `src/lib/cache/lookup.ts:enqueueRefresh` — 删掉 `prisma.repository.upsert(...)`。只保留 `prisma.refreshJob.upsert(...)`。
- `src/lib/cache/write.ts:storeRepoMetadata` — 改成 `findRepoByCanonical → branch → createRepo | updateRepo`。
- `src/lib/db/repositories.ts` — 新增 `createRepo(data)`、`updateRepo({id, data})`、`findRepoByCanonical(owner, name)` 三个导出。
- `src/lib/db/refresh-jobs.ts` — `createRefreshJob` / `updateRefreshJob` 签名加 `owner` / `name` 参数。
- `src/lib/jobs/refresh-one.ts` — drop `Repository include` on `claimOne`;404 / 410 / 403 分支删掉 `storeRepoMetadata` 调用。
- `src/lib/scheduler/lease.ts:claimBatch` — 返回 `RefreshJob[]`(不再 join Repository)。
- `src/app/admin/repositories/page.tsx` — 删 filter chip + `?status=...` 解析逻辑。
- `src/app/api/admin/providers/[id]/run/route.ts` — **DELETE**.
- `src/lib/ingestion/providers/run.ts` — `runProvider` 函数删除。
- `src/app/admin/ingestion/_components/run-via-provider.tsx` — 删除(整个组件不再使用)。
- `src/app/admin/refresh/_components/pending-jobs-table.tsx` — 列从 `repositoryId` 改成 `owner / name`(pending jobs 没有 repositoryId)。

### Audit log 增量

| action | targetId | metadata |
|---|---|---|
| `refresh.failed_review` | `${owner}/${name}` | `{ attempts, lastError, httpStatus: 404 \| 410 }` |
| `repo_forbidden` | `${owner}/${name}` | `{ attempts, lastError, httpStatus: 403 }` |

之前的 metadata 字段 `repoId` 删除。

## 数据流

### 1. Cache miss (new repo)

```
GET /api/v1/repos/octocat/hello-world
  → lookupRepo(owner='octocat', name='hello-world')
    → getRepoMetadata('octocat/hello-world')  // SELECT repositories
      → returns { found: false }               // 表里没有
    → enqueueRefresh('octocat', 'hello-world')
      → prisma.refreshJob.upsert({ where: { owner_name }, ... })
        // repositoryId = null (schema 默认)
        // owner = 'octocat', name = 'hello-world'
      → returns jobId
    → returns { fetch_status: 'pending', expected_at, result_url, ... }

// 关键: 这一步 repositories 表一行没动
// 验证: prisma.repository.count({ where: { owner: 'octocat' } }) === 0
```

### 2. Successful refresh

```
scheduler tick
  → claimBatch()                          // SELECT refresh_jobs ... FOR UPDATE
    → [RefreshJob{ id, owner: 'octocat', name: 'hello-world', repositoryId: null }, ...]
  → refreshOne(job)
    → findRepoByCanonical('octocat', 'hello-world')
      → returns null                       // 第一次,cache miss
    → fetchGitHub('octocat/hello-world')
      → 200 OK + JSON
    → baseData = parseRepoMetadata(ghJson)
    → storeRepoMetadata(baseData)
      → existing === null → createRepo(baseData)
        → INSERT repositories (id, owner, name, stars, forks, ..., fetch_status='ok')
      → refreshJob.update({ status: 'succeeded', repositoryId: newRepo.id })

// 第二次 tick (10 秒后):
  → claimBatch()
    → [RefreshJob{ id, owner: 'octocat', name: 'hello-world', repositoryId: 123 }, ...]
  → refreshOne(job)
    → findRepoByCanonical('octocat', 'hello-world')
      → returns { id: 123, stars: 5000, ... }
    → fetchGitHub(...) → 304 Not Modified
    → baseData = parseRepoMetadata(ghJson) // 用 ETag 复用的旧数据
    → storeRepoMetadata(baseData)
      → existing !== null → updateRepo({ id: 123, data: baseData })
        → UPDATE repositories SET stars = 5000, ... WHERE id = 123
      → refreshJob.update({ status: 'succeeded', repositoryId: 123 })
```

### 3. Failed refresh (404 / 410)

```
scheduler tick
  → claimBatch()
    → [RefreshJob{ id, owner: 'octocat', name: 'deleted-repo', repositoryId: null }, ...]
  → refreshOne(job)
    → findRepoByCanonical('octocat', 'deleted-repo')
      → returns null                       // 仍然没有
    → fetchGitHub('octocat/deleted-repo')
      → 404 Not Found
    → (404 / 410 分支)
      → refreshJob.update({
          status: 'pending',
          attempts: attempts + 1,
          lastError: 'not_found',
          scheduledFor: now + 24h,
        })
      → audit.log({
          action: 'refresh.failed_review',
          targetId: 'octocat/deleted-repo',
          metadata: { attempts, lastError, httpStatus: 404 },
        })
      // storeRepoMetadata NOT CALLED
      // repositories 表完全不动

// 验证 (10 次重试后):
// prisma.repository.count({ where: { owner: 'octocat', name: 'deleted-repo' } }) === 0
// prisma.auditLog.count({ where: { action: 'refresh.failed_review', targetId: 'octocat/deleted-repo' } }) === 10
```

## 影响范围

### Files modified (15)

- `prisma/schema.prisma` — `RefreshJob.repositoryId` nullable + `owner`/`name` 列
- `prisma/migrations/20260913000000_no_stub_pending/migration.sql` — 3-step SQL
- `src/lib/cache/lookup.ts` — `enqueueRefresh` 删 repository.upsert
- `src/lib/cache/write.ts` — `storeRepoMetadata` 拆 find/branch/write
- `src/lib/db/repositories.ts` — 新增 `createRepo` / `updateRepo` / `findRepoByCanonical`
- `src/lib/db/refresh-jobs.ts` — 函数签名加 owner/name
- `src/lib/jobs/refresh-one.ts` — 404/410/403 不调 storeRepoMetadata
- `src/lib/scheduler/lease.ts` — `claimBatch` 返回 `RefreshJob[]` (no Repository join)
- `src/lib/scheduler/tick.ts` — 适配 claimBatch 新签名
- `src/lib/scheduler/sweep.ts` — 适配 claimBatch 新签名
- `src/lib/reports/ingestion.ts` — 报告查询 join 改成 owner/name
- `src/app/admin/_components/admin-job-card.tsx` — 字段从 repositoryId 改 owner/name
- `src/app/admin/_components/admin-job-card-grid.tsx` — 同上
- `src/app/admin/queue/page.tsx` — 同上
- `src/app/admin/queue/_components/queue-sections.tsx` — 同上
- `src/app/admin/refresh/page.tsx` — 同上
- `src/app/admin/refresh/_components/pending-jobs-table.tsx` — 列从 repositoryId 改 owner/name
- `src/app/admin/repositories/page.tsx` — 删 filter chip
- `src/app/api/admin/refresh/route.ts` — 序列化字段调整
- `messages/en.json` — 新增 audit action labels
- `messages/zh.json` — 同上

### Files created (8)

- `scripts/migrations/backfill-pending-jobs.ts` — 独立 backfill 脚本(给运营手动跑,migration 内的 backfill 是同一份逻辑的 inline 版)
- `test/load-50.mjs` — 50 个 repo 的 end-to-end smoke
- `test/README.md` — 测试夹具说明
- `test/.gitkeep` — 占位
- `tests/integration/lookup-pending-no-row.test.ts` — Task 9: lookup 不写 Repository 行
- `tests/integration/refresh-one-no-stub-on-failure.test.ts` — Task 9: 失败路径不写
- `tests/integration/admin-repositories-only-ok.test.ts` — Task 9: admin 页面只展示 ok
- `tests/integration/provider-run-removed.test.ts` — Task 9: provider run 路由 404

### Files deleted (1)

- `src/app/api/admin/providers/[id]/run/route.ts`

## 风险

### 1. P2002 race on `@@unique([owner, name])`

两个 worker 同时 `findRepoByCanonical → null → createRepo`,后写的人抛 P2002 unique violation。prisma 不 catch,冒泡到 `refresh-one.ts` error handler,M31 的处理是:把 job status 设回 `pending`,attempts++,scheduledFor +60s,下次重试。

**当前 scope 不修,标记为 M32 TODO。** 实际命中概率低:`claimBatch` 的 `lockedUntil` lease 让同一 (owner, name) 大概率不会同时进 active set,且 `RefreshJob` 的 `@@unique([owner, name])` 在 enqueue 阶段已经去重了。Scheduler 重启瞬间可能有竞态。

### 2. Orphan pending jobs if `backfill-pending-jobs.ts` not run

migration 内 step 2 的 `UPDATE ... JOIN` 受影响行数必须 == `refresh_jobs` 总行数。如果某 `RefreshJob.repositoryId` 指向一个被手动 delete 的 `Repository` 行,JOIN 漏掉,owner/name 是 NULL。

Migration 检测到这个会 abort(committed transaction rollback)并打 warning。**运营必须在 production deploy 前手动删除那些 orphan 行**(或者改写 SQL 用 LEFT JOIN + 把 owner/name 设成 `'__orphan__'` + status='failed',然后人工 audit)。

### 3. 404 / 410 retry 行为不变,但信号源改变

之前 404 会在 `repositories` 表里留一行 `fetchStatus: 'not_found'`,admin 能在 `/admin/repositories` 里看到。M31 之后,`repositories` 表里完全没有这行,**只有 audit log 是失败记录**。

运营需要改变习惯:查"哪些 repo 拉不到"从 `/admin/repositories?status=not_found` 改成 `/admin/audit?action=refresh.failed_review`。文档需要在 `/admin/audit` 页加一段说明。

### 4. `storeRepoReleases` / `storeRepoBranches` 处理 null repo

这些 per-facet writer 已经在 M28 改成 "log warning + return on null",M31 不破坏它们 — releases/branches jobs 只在 repo row 已存在后才会被 enqueue(从 `refresh-one.ts` 走 `enqueueFacetJobs`)。

**但是:** cache miss 第一次 fetch 拿到 200,`storeRepoMetadata` 写了 repo,但因为 facet jobs 是 enqueue 阶段独立 schedule,它们可能在 repo 行写入完成前就被 worker 拉走。M28 已经处理 — `storeRepoReleases` / `storeRepoBranches` 接 null 就 graceful return。**可接受** 因为 releases/branches 不在 cache-miss 关键路径上,下次重试会补全。

### 5. `/admin/repositories` URL compat

老的 `?status=not_found` / `?status=forbidden` / `?status=error` URL 现在 silently filter to nothing(因为没东西被过滤掉,实际展示所有 ok 行)。运营需要被通知这个 URL 变化。

**没有 301 redirect** — 因为目标语义不同(redirect 到全部 ok 行会让老 URL "看起来工作但语义错了"),宁可 silently drop filter 参数。文档里写明。

## 测试

### Unit + integration coverage

- 4 个新 integration test(Task 9):
  - `tests/integration/lookup-pending-no-row.test.ts` — cache miss 不写 repositories
  - `tests/integration/refresh-one-no-stub-on-failure.test.ts` — 404/410/403 不写
  - `tests/integration/admin-repositories-only-ok.test.ts` — admin 页面 query 不带 status filter
  - `tests/integration/provider-run-removed.test.ts` — `/api/admin/providers/[id]/run` 返回 404
- 1 个 `tests/integration/cache-write.test.ts` 扩展 — 新增 find/branch/write 三分支覆盖(createRepo / updateRepo / existing==null 分支)
- `test/load-50.mjs` end-to-end smoke — 50 个 repo 并发 lookup → drain scheduler → 二次 lookup 验证全部 fetch_status='ok'

### Existing tests updated

- `tests/integration/refresh-one.test.ts` — mock 改成 owner/name-based claim
- `tests/integration/scheduler-lease.test.ts` — `claimBatch` 返回值断言去掉 Repository join
- `tests/unit/db-refresh-jobs-queue.test.ts` — 新 signature 加 owner/name 参数
- `tests/unit/admin-job-card-grid.test.tsx` — 列渲染从 repositoryId 改 owner/name
- `tests/unit/admin-refresh-i18n.test.tsx` — pending-jobs-table 新 mock 字段

### Verification commands

```bash
npx prisma migrate deploy
npx tsc --noEmit
npm run lint
npm test
npm run dev:server  # 重启 (pool + scheduler 内存状态)
node test/load-50.mjs
```

### Browser checks

- `/admin/repositories` — 展示 50 个 repo,filter chip 消失,URL 不再有 `?status=...`
- `/admin/providers` — 详情页只剩 CRUD + Preview,**没有** "Run" 按钮
- `/admin/ingestion` — pending queue counter 仍正常工作,`<RunViaProvider />` 已删除
- `/admin/audit` — `repo_forbidden` / `refresh.failed_review` action 可搜到

## 不做什么 (scope)

- 不修 P2002 race(M32 TODO)
- 不改 `/admin/repositories` 其它 UI(分页、排序、列保持)
- 不改 public surface(`/repo/[owner]/[name]` 页面不动,M29 主题不动)
- 不改 `/api/v1/repos/[owner]/[name]` 的 response shape(200 + pending JSON 形状不变)
- 不改 webhook 投递逻辑(M30.7a 已修)
- 不改 ETA estimator(M30.7c 保留)
- 不改 auto-pause scheduler(M22 保留)
- 不改 per-user timezone(M23 保留)
- 不改 Wulan theme(M24 保留)
- 不改 admin sidebar groups(M30.8 保留)
