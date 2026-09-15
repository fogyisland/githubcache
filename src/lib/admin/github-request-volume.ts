import { prisma } from '@/lib/db/client';

export type GithubEndpoint = 'core' | 'releases' | 'branches';

export interface GithubRequestVolumeBucket {
  hour: Date;
  core: number;
  releases: number;
  branches: number;
}

export type Window = '24h' | '7d';

/**
 * Write a row to github_request_events. Caller's own try/catch (or .catch)
 * is responsible for not breaking the upstream GitHub call when this
 * insert fails — we just re-throw so the caller can warn.
 */
export async function recordGithubCall(
  endpoint: GithubEndpoint,
  tokenId: bigint | null,
  statusCode: number,
): Promise<void> {
  await prisma.githubRequestEvent.create({
    data: { endpoint, tokenId, statusCode },
  });
}

/**
 * Aggregate github_request_events into hourly (24h) or daily (7d) buckets.
 * Fills zero-buckets for missing hours/days so the chart X-axis is
 * complete. Caller injects `now` to keep the function pure and easy to
 * test.
 */
export async function loadGithubRequestVolume(
  window: Window,
  now: Date = new Date(),
): Promise<GithubRequestVolumeBucket[]> {
  if (window === '24h') {
    return load24h(now);
  }
  return load7d(now);
}

async function load24h(now: Date): Promise<GithubRequestVolumeBucket[]> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  // DATE_FORMAT returns VARCHAR (string), not Date — narrow to string.
  const rows = await prisma.$queryRaw<
    Array<{ hour: string; core: bigint; releases: bigint; branches: bigint }>
  >`
    SELECT
      DATE_FORMAT(occurred_at, '%Y-%m-%d %H:00:00') AS hour,
      SUM(CASE WHEN endpoint = 'core' THEN 1 ELSE 0 END) AS core,
      SUM(CASE WHEN endpoint = 'releases' THEN 1 ELSE 0 END) AS releases,
      SUM(CASE WHEN endpoint = 'branches' THEN 1 ELSE 0 END) AS branches
    FROM github_request_events
    WHERE occurred_at >= ${since} AND occurred_at < ${now}
    GROUP BY hour
    ORDER BY hour ASC
  `;
  return fillHourlyGaps(since, now, rows);
}

async function load7d(now: Date): Promise<GithubRequestVolumeBucket[]> {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  // DATE() comes back from Prisma as a JS Date in the SERVER's local TZ
  // (mysql connector behavior, not a string). Date-only — midnight local.
  const rows = await prisma.$queryRaw<
    Array<{ day: Date; core: bigint; releases: bigint; branches: bigint }>
  >`
    SELECT
      DATE(occurred_at) AS day,
      SUM(CASE WHEN endpoint = 'core' THEN 1 ELSE 0 END) AS core,
      SUM(CASE WHEN endpoint = 'releases' THEN 1 ELSE 0 END) AS releases,
      SUM(CASE WHEN endpoint = 'branches' THEN 1 ELSE 0 END) AS branches
    FROM github_request_events
    WHERE occurred_at >= ${since} AND occurred_at < ${now}
    GROUP BY day
    ORDER BY day ASC
  `;
  return fillDailyGaps(since, now, rows);
}

interface RawHourRow {
  hour: string;
  core: bigint;
  releases: bigint;
  branches: bigint;
}

interface RawDayRow {
  day: Date;
  core: bigint;
  releases: bigint;
  branches: bigint;
}

function fillHourlyGaps(
  since: Date,
  now: Date,
  rows: RawHourRow[],
): GithubRequestVolumeBucket[] {
  const map = new Map<string, GithubRequestVolumeBucket>();
  for (const r of rows) {
    const parsed = parseHourString(r.hour);
    const key = toHourKey(parsed);
    map.set(key, {
      hour: parsed,
      core: Number(r.core),
      releases: Number(r.releases),
      branches: Number(r.branches),
    });
  }
  const out: GithubRequestVolumeBucket[] = [];
  // Always produce exactly 24 hour-buckets. The right-most bucket is the
  // hour containing `now` (may be a partial hour with sparse data — that's
  // fine, it'll just show a small number). The 23 buckets before it cover
  // the previous 23 full hours.
  //
  // Example: now=12:34 → endMs=12:00 (start of current hour),
  // startMs=13:00 yesterday. Walk [13:00 yesterday .. 12:00 today] = 24.
  // Example: now=12:00:00Z exact → endMs=12:00, startMs=13:00 yesterday.
  // Walk = 24. (Tests use the exact-on-hour form, so this is important.)
  const endMs =
    Math.floor(now.getTime() / (60 * 60 * 1000)) * 60 * 60 * 1000;
  const startMs = endMs - 23 * 60 * 60 * 1000;
  for (let t = startMs; t <= endMs; t += 60 * 60 * 1000) {
    const h = new Date(t);
    const key = toHourKey(h);
    const existing = map.get(key);
    if (existing) {
      out.push(existing);
    } else {
      out.push({ hour: h, core: 0, releases: 0, branches: 0 });
    }
  }
  return out;
}

function fillDailyGaps(
  _since: Date,
  now: Date,
  rows: RawDayRow[],
): GithubRequestVolumeBucket[] {
  const map = new Map<string, GithubRequestVolumeBucket>();
  for (const r of rows) {
    // r.day comes back from Prisma as a JS Date in the SERVER's local TZ,
    // representing midnight on that day. Normalize to UTC midnight so
    // downstream formatters render uniformly.
    const parsed = new Date(
      Date.UTC(r.day.getFullYear(), r.day.getMonth(), r.day.getDate()),
    );
    const key = toDayKey(parsed);
    map.set(key, {
      hour: parsed,
      core: Number(r.core),
      releases: Number(r.releases),
      branches: Number(r.branches),
    });
  }
  // 7-day window: 7 daily buckets ending on today's UTC date (inclusive).
  // This means days from (today - 6 days) through today.
  const endUtcMidnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const startUtcMidnight = new Date(endUtcMidnight.getTime() - 6 * 24 * 60 * 60 * 1000);
  const out: GithubRequestVolumeBucket[] = [];
  for (let t = startUtcMidnight.getTime();
       t <= endUtcMidnight.getTime();
       t += 24 * 60 * 60 * 1000) {
    const d = new Date(t);
    const key = toDayKey(d);
    const existing = map.get(key);
    if (existing) {
      out.push(existing);
    } else {
      out.push({ hour: d, core: 0, releases: 0, branches: 0 });
    }
  }
  return out;
}

/**
 * MySQL's DATE_FORMAT('%Y-%m-%d %H:00:00') yields strings like
 * '2026-09-15 11:00:00' — parse them as UTC so bucket math matches the
 * server's clock.
 */
function parseHourString(s: string): Date {
  // 'YYYY-MM-DD HH:00:00' → Date.UTC(...)
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):00:00$/.exec(s);
  if (!m) throw new Error(`bad hour string from MySQL: ${s}`);
  return new Date(
    Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
    ),
  );
}

function toHourKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:00:00`;
}

function toDayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}
