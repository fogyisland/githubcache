# Operations Runbook

> For on-call operators responding to alerts. Read `/api/v1/status` first.

## Health Check

The single source of truth is **`GET /api/v1/status`**. Read it before doing
anything else.

- `ok: true` + `db: "up"` — service is healthy; review token + queue counts
- `ok: false` + `db: "down"` — DB unreachable; HTTP 503
- `ok: true` + `tokens.active: 0` — all GitHub tokens exhausted or disabled;
  `/api/query` will fail until tokens recover
- `ok: true` + `tokens.exhausted > 0` — some tokens are at the rate ceiling;
  wait for `resetAt` or rotate
- `ok: true` + `queue.pending > 5000` — backlog; investigate before scaling
- `ok: true` + `queue.failed > 100` — many refresh jobs failed; check the
  `refresh.failed_review` audit entries

Response body fields:

```
{
  ok, db,
  tokens: { active, exhausted, total },
  queue: { pending, in_progress, done, failed },
  repositories: { total, ok, not_found, forbidden, error },
  version: { commit, startedAt, nodeVersion },
  timestamp
}
```

`queue.done` is a 24-hour rolling count of completed jobs (filtered on
`updatedAt >= now - 24h`).

## Common Alerts

### Alert: `githubcache_status_ok == false` (or HTTP 503 from `/api/v1/status`)

1. Confirm with `curl -s http://<host>:3000/api/v1/status | jq .db`
2. If `db: "down"`:
   - Check DB host reachability: `mysqladmin ping -h $DB_HOST -u $DB_USER -p`
   - Verify `DATABASE_URL` is set correctly in the runtime env
   - Check DB connection count / capacity on MySQL
   - Verify network path (security group, firewall, VPC peering)
3. If DB is up but the service still reports down, restart the container:
   - `docker restart githubcache` (or your platform equivalent)
   - In k8s: `kubectl rollout restart deploy/githubcache`
4. If the alert repeats, escalate to the DB team.

### Alert: `githubcache_tokens_active == 0`

1. Inspect tokens: `curl -s http://<host>:3000/api/v1/status | jq .tokens`
2. Open the admin UI at **`/admin/github-tokens`** to see status, remaining
   quota, and `resetAt` per token.
3. If `tokens.exhausted > 0`:
   - Wait for the GitHub rate-limit reset window (typically 1 hour)
   - Or rotate to fresh tokens via the admin UI
4. If tokens are **disabled**, fix the underlying issue, then re-enable them
   in the admin UI.
5. If there are no tokens at all, add via env (`GITHUB_TOKENS=ghp_aaa,ghp_bbb`)
   or `GITHUB_TOKENS_FILE=/path/to/tokens`, then restart.

### Alert: `githubcache_queue_pending_high` (> 5000)

1. Inspect failed reviews: `curl -s 'http://<host>:3000/admin/audit?action=refresh.failed_review'`
   (or use the admin UI's audit search at **`/admin/audit`**).
2. Common causes:
   - **GitHub token expired** — rotate tokens via `/admin/github-tokens`
   - **GitHub returning 403** for many private repos — check the repos'
     visibility / token scopes
   - **GitHub returning 404** — repos may have been deleted; safe to ignore
     after admin review
3. To drain the backlog:
   - **Pause the scheduler** via **`/admin/refresh`** or
     `POST /api/admin/refresh { "action": "pause" }`
   - **Trigger** high-priority jobs:
     `POST /api/admin/refresh { "action": "trigger", "owner": "...", "name": "..." }`
   - **Resume** once catch-up is healthy:
     `POST /api/admin/refresh { "action": "resume" }`

### Alert: `githubcache_rate_limit_429_spike`

The `/api/query` endpoint returns **HTTP 429** when an API key exceeds its
`rateLimitPerMin`. The response carries:

- `Retry-After` (seconds)
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`

If a single key is misbehaving:

1. Open **`/admin/api-keys`** and locate the key by ID or label.
2. Lower its `rateLimitPerMin` or revoke it.
3. Cross-reference **`/admin/audit`** for the key's recent activity (target
   repos, frequency, errors).

### Alert: `githubcache_stale_data_warning`

When GitHub is unreachable, the API serves cached data with `stale: true` and
an attached `warning` field on each result row. **This is expected behavior,
not a failure.**

1. Confirm GitHub is down: `curl -s https://api.github.com/zen`
2. Wait for GitHub recovery.
3. Once GitHub is back, the scheduler refreshes stale rows within one tick
   (≤ `SCHEDULER_TICK_MS`, default 60s). The `warning` field disappears when
   fresh data is written.

## Migrations

### Running migrations (production)

```bash
docker exec githubcache npx prisma migrate deploy
```

This is idempotent — re-running is safe. Run after every deploy that ships a
new migration in `prisma/migrations/`.

In Kubernetes, run this from a one-shot init container or pre-deploy job; the
running app containers do not self-migrate.

### Creating a new migration (dev)

```bash
npx prisma migrate dev --name <short_description>
```

This auto-generates SQL at
`prisma/migrations/<timestamp>_<name>/migration.sql`. Review the generated SQL
carefully before committing — Prisma's auto-diff is good but not infallible.

## Incident: GitHub fully down

**Expected behavior — no operator action required unless the rate budget is
exhausted or a specific row must be fresh immediately:**

1. All `/api/query` first-miss requests return cached data with `stale: true`
   and a `warning` field.
2. All `/api/query` first-miss requests for **unknown** repos return
   `fetch_status: "error"`.
3. Background refresh jobs fail with `kind: "unexpected"`; after 5 consecutive
   failures on the same row, an audit entry is written with action
   `refresh.failed_review`.
4. Once GitHub recovers, the scheduler resumes normal operation; stale rows
   are refreshed within one tick.

If a specific repo's metadata must be fresh **now**:

```bash
curl -X POST http://<host>:3000/api/admin/refresh \
  -H 'Content-Type: application/json' \
  -d '{ "action": "trigger", "owner": "...", "name": "..." }'
```

## Disaster Recovery

### Full database loss

1. Restore MySQL from backup (out of scope for this runbook).
2. Run `npx prisma migrate deploy` to ensure the schema is current.
3. The next scheduler tick will enqueue a refresh job for every row in
   `repositories`. The queue will be large; expect several minutes of
   catch-up.
4. Monitor `GET /api/v1/status` until `queue.pending` drops to baseline and
   `repositories.ok` returns to its prior level.

### Service crash loop

1. Inspect container logs: `docker logs githubcache --tail 200` (or
   `kubectl logs -l app=githubcache --tail=200`).
2. Common root causes:
   - `DATABASE_URL` misconfigured / not set in the runtime env
   - `SESSION_SECRET` shorter than 32 chars
   - Prisma client not generated — run `npx prisma generate` then redeploy
3. If the pod is being killed, check for OOM:
   `docker inspect githubcache | grep OOMKilled`
   (or `kubectl describe pod <pod> | grep -i oom`).
4. If the loop persists, capture full logs + a `docker inspect` / `kubectl
   describe` and escalate.

## Where to look

| Need | Path |
|---|---|
| Overall service health | `GET /api/v1/status` |
| GitHub token health | `/admin/github-tokens` |
| Audit log (action / actor / target / date filters) | `/admin/audit` |
| Failed reviews needing attention | `/admin/audit?action=refresh.failed_review` |
| Queue depth + repo status breakdown | `GET /api/v1/status` → `queue.*`, `repositories.*` |
| Manual refresh controls (pause / resume / trigger) | `/admin/refresh` |
| API key management (revoke, lower rate limit) | `/admin/api-keys` |
| User management | `/admin/users` |
| Usage analytics + reports | `/admin/reports` |