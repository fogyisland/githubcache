export interface RepoCoreData {
  name: string;
  description: string | null;
  private: boolean;
  defaultBranch: string;
  stars: number;
  forks: number;
  watchers: number;
  createdAt: string;
  updatedAt: string;
  pushedAt: string | null;
  language: string | null;
  license: string | null;
  topics: string[];
  homepage: string | null;
  archived: boolean;
  disabled: boolean;
}

interface RawRepoResponse {
  name?: unknown;
  description?: unknown;
  private?: unknown;
  default_branch?: unknown;
  stargazers_count?: unknown;
  forks_count?: unknown;
  subscribers_count?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  pushed_at?: unknown;
  language?: unknown;
  license?: { spdx_id?: unknown } | null;
  topics?: unknown;
  homepage?: unknown;
  archived?: unknown;
  disabled?: unknown;
}

export function parseRepoResponse(raw: unknown): RepoCoreData {
  const r = raw as RawRepoResponse;
  return {
    name: String(r.name ?? ''),
    description: (r.description ?? null) as string | null,
    private: Boolean(r.private),
    defaultBranch: String(r.default_branch ?? 'main'),
    stars: Number(r.stargazers_count ?? 0),
    forks: Number(r.forks_count ?? 0),
    watchers: Number(r.subscribers_count ?? 0),
    createdAt: String(r.created_at ?? ''),
    updatedAt: String(r.updated_at ?? ''),
    pushedAt: (r.pushed_at ?? null) as string | null,
    language: (r.language ?? null) as string | null,
    license: r.license?.spdx_id != null ? String(r.license.spdx_id) : null,
    topics: Array.isArray(r.topics) ? (r.topics as unknown[]).map(String) : [],
    homepage: (r.homepage ?? null) as string | null,
    archived: Boolean(r.archived),
    disabled: Boolean(r.disabled),
  };
}