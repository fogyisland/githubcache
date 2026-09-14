import type { ReactElement } from 'react';

/**
 * Group the top-level keys of a GitHub repository response blob into
 * operator-meaningful buckets for the admin detail page. We stored
 * the raw JSON on the repositories.node column at fetch time; rather
 * than dump all 87 fields as a wall of JSON, we split them into
 * stats / license / owner / permissions / url-templates so the
 * operator can collapse the noise.
 *
 * Bucket layout (in render order):
 *   1. stats         — default open (the most-asked question)
 *   2. identity      — id, node_id, name, full_name, html_url, url, fork
 *   3. visibility    — private, archived, disabled, has_*, allow_*
 *   4. timestamps    — created_at, updated_at, pushed_at
 *   5. content       — default_branch, description, homepage, language
 *   6. license       — license object, topics array
 *   7. owner         — owner object, organization
 *   8. permissions   — viewer permissions object
 *   9. urls          — every star-url template field
 *  10. misc          — custom_properties, mirror_url, fallthrough
 *
 * Each bucket carries `keys` so the render layer can show a count
 * badge next to the heading (stats, 11 fields). Missing keys are
 * simply absent — we do not render an empty section.
 */

export interface NodeBucket {
  /** Stable id for React keys + test snapshots. */
  id: string;
  /** Short label shown in the `<summary>` eyebrow. */
  label: string;
  /** Field count — drives the badge in the heading. */
  keys: readonly string[];
  /** The bucket's slice of `node` (already filtered to present keys). */
  data: Record<string, unknown>;
  /** When true the `<details>` opens by default. */
  defaultOpen: boolean;
}

const KNOWN_KEYS = new Set<string>([
  // identity
  'id', 'node_id', 'name', 'full_name', 'html_url', 'url', 'fork',
  // visibility
  'private', 'visibility', 'archived', 'disabled', 'is_template',
  'has_issues', 'has_projects', 'has_wiki', 'has_pages', 'has_downloads',
  'has_discussions', 'has_pull_requests', 'allow_forking',
  'web_commit_signoff_required', 'pull_request_creation_policy',
  // stats
  'watchers', 'watchers_count', 'stargazers_count', 'forks', 'forks_count',
  'open_issues', 'open_issues_count', 'network_count', 'subscribers_count',
  'size',
  // timestamps
  'created_at', 'updated_at', 'pushed_at',
  // content
  'default_branch', 'description', 'homepage', 'language',
  // license + topics
  'license', 'topics',
  // owner
  'owner', 'organization',
  // permissions
  'permissions',
  // misc
  'custom_properties', 'mirror_url', 'temp_clone_token',
]);

const BUCKET_DEFS: ReadonlyArray<{
  id: string;
  label: string;
  keys: readonly string[];
  defaultOpen: boolean;
}> = [
  { id: 'stats', label: 'stats', keys: [
    'watchers', 'watchers_count', 'stargazers_count',
    'forks', 'forks_count',
    'open_issues', 'open_issues_count',
    'network_count', 'subscribers_count', 'size',
  ], defaultOpen: true },
  { id: 'identity', label: 'identity', keys: [
    'id', 'node_id', 'name', 'full_name', 'html_url', 'url', 'fork',
  ], defaultOpen: false },
  { id: 'visibility', label: 'visibility & flags', keys: [
    'private', 'visibility', 'archived', 'disabled', 'is_template',
    'has_issues', 'has_projects', 'has_wiki', 'has_pages', 'has_downloads',
    'has_discussions', 'has_pull_requests', 'allow_forking',
    'web_commit_signoff_required', 'pull_request_creation_policy',
  ], defaultOpen: false },
  { id: 'timestamps', label: 'timestamps', keys: [
    'created_at', 'updated_at', 'pushed_at',
  ], defaultOpen: false },
  { id: 'content', label: 'content', keys: [
    'default_branch', 'description', 'homepage', 'language',
  ], defaultOpen: false },
  { id: 'license', label: 'license & topics', keys: [
    'license', 'topics',
  ], defaultOpen: false },
  { id: 'owner', label: 'owner', keys: [
    'owner', 'organization',
  ], defaultOpen: false },
  { id: 'permissions', label: 'permissions', keys: [
    'permissions',
  ], defaultOpen: false },
  { id: 'urls', label: 'url templates', keys: [
    // populated dynamically — anything ending with `_url` that isn't in KNOWN_KEYS
  ], defaultOpen: false },
  { id: 'misc', label: 'other', keys: [
    // Populated dynamically in Pass 3 — anything in KNOWN_KEYS that
    // wasn't claimed by a named bucket (custom_properties,
    // mirror_url, temp_clone_token) plus truly unknown future fields.
  ], defaultOpen: false },
];

/**
 * Split a GitHub `node` blob into operator-meaningful buckets.
 * Returns one entry per bucket that has at least one present key,
 * plus a synthetic `urls` bucket that catches every `*_url` field
 * we don't classify elsewhere. Unknown keys (e.g. a future GitHub
 * field we haven't seen) fall into `misc` so they're never silently
 * dropped — operators want to see *something* about a new field.
 */
export function bucketRepoNode(node: unknown): NodeBucket[] {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    return [];
  }
  const n = node as Record<string, unknown>;
  const presentKeys = Object.keys(n);

  const buckets: NodeBucket[] = [];
  const consumed = new Set<string>();

  // Pass 1 — the named buckets (everything except `urls`).
  for (const def of BUCKET_DEFS) {
    if (def.id === 'urls') continue;
    const data: Record<string, unknown> = {};
    const present: string[] = [];
    for (const k of def.keys) {
      if (k in n && n[k] !== undefined) {
        data[k] = n[k];
        present.push(k);
        consumed.add(k);
      }
    }
    if (present.length > 0) {
      buckets.push({
        id: def.id,
        label: def.label,
        keys: present,
        data,
        defaultOpen: def.defaultOpen,
      });
    }
  }

  // Pass 2 — `urls` bucket: every `*_url` field that wasn't consumed
  // by a named bucket (template fields like `stargazers_url` live here).
  const urlsData: Record<string, unknown> = {};
  const urlsKeys: string[] = [];
  for (const k of presentKeys) {
    if (consumed.has(k)) continue;
    if (!k.endsWith('_url')) continue;
    urlsData[k] = n[k];
    urlsKeys.push(k);
    consumed.add(k);
  }
  if (urlsKeys.length > 0) {
    buckets.push({
      id: 'urls',
      label: 'url templates',
      keys: urlsKeys,
      data: urlsData,
      defaultOpen: false,
    });
  }

  // Pass 3 — `misc`: anything that didn't fit. We catch BOTH the
  // known-but-unclassified fields (custom_properties / mirror_url /
  // temp_clone_token — we know they exist but they don't deserve
  // their own bucket) AND any future GH field we haven't seen yet.
  const miscData: Record<string, unknown> = {};
  const miscKeys: string[] = [];
  for (const k of presentKeys) {
    if (consumed.has(k)) continue;
    // Skip null/undefined — the page shouldn't render empty rows.
    if (n[k] === undefined) continue;
    miscData[k] = n[k];
    miscKeys.push(k);
  }
  if (miscKeys.length > 0) {
    buckets.push({
      id: 'misc',
      label: 'other',
      keys: miscKeys,
      data: miscData,
      defaultOpen: false,
    });
  }

  return buckets;
}

/**
 * Render a single bucket's `<details>` block. Pulled out as its own
 * pure component so the page can map over `buckets` without repeating
 * the chrome on every section.
 */
export function NodeBucketSection({ bucket }: { bucket: NodeBucket }): ReactElement {
  return (
    <details
      className="ghc-api-shape-details"
      data-testid={`ghc-admin-repo-node-${bucket.id}`}
      {...(bucket.defaultOpen ? { open: true } : {})}
    >
      <summary className="ghc-api-shape-summary">
        <span className="ghc-section-eyebrow">{bucket.label}</span>
        <span className="ghc-api-shape-hint">{bucket.keys.length} fields</span>
      </summary>
      <pre className="ghc-code-block ghc-api-shape-pre">
        <code>{JSON.stringify(bucket.data, null, 2)}</code>
      </pre>
    </details>
  );
}