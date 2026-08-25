interface Repo {
  id: string;
  owner: string;
  name: string;
}

/**
 * Plain HTML <select> for the repository picker. Server component (no
 * interactivity — selection state lives in the surrounding form). Renders
 * `#id — owner/name` for each repo.
 *
 * Used by /admin/refresh's trigger form.
 */
export function RepoPicker({ repos }: { repos: Repo[] }) {
  return (
    <select
      name="repoId"
      className="rounded border border-gray-300 px-2 py-1 text-sm"
      defaultValue=""
    >
      <option value="" disabled>
        Select a repository…
      </option>
      {repos.map((r) => (
        <option key={r.id} value={r.id}>
          #{r.id} — {r.owner}/{r.name}
        </option>
      ))}
    </select>
  );
}
