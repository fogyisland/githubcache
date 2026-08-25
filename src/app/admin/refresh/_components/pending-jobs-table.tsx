interface Job {
  id: string;
  repositoryId: string;
  priority: number;
  scheduledFor: Date;
  attempts: number;
  repository: { owner: string; name: string };
}

/**
 * Server component — read-only table of the most-urgent pending refresh jobs.
 * Used by /admin/refresh.
 *
 * Sorted by the parent query (priority ASC, scheduledFor ASC). Top 20.
 */
export function PendingJobsTable({ jobs }: { jobs: Job[] }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold">Pending refresh jobs (top 20)</h2>
      {jobs.length === 0 ? (
        <p className="text-sm text-gray-500">No pending jobs.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 text-gray-500">
            <tr>
              <th className="py-2">Job ID</th>
              <th className="py-2">Repository</th>
              <th className="py-2 text-right">Priority</th>
              <th className="py-2 text-right">Scheduled</th>
              <th className="py-2 text-right">Attempts</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className="border-b border-gray-100">
                <td className="py-2 font-mono text-xs">#{j.id}</td>
                <td className="py-2 font-mono text-xs">
                  {j.repository.owner}/{j.repository.name}
                </td>
                <td className="py-2 text-right">{j.priority}</td>
                <td className="py-2 text-right font-mono text-xs">
                  {j.scheduledFor.toISOString()}
                </td>
                <td className="py-2 text-right">{j.attempts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
