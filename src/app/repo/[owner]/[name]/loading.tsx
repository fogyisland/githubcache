export default function RepoLoading() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <div className="animate-pulse">
        <div className="h-8 w-2/3 rounded bg-gray-200" />
        <div className="mt-4 h-4 w-1/2 rounded bg-gray-200" />
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 rounded-lg bg-gray-100" />
          ))}
        </div>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="h-40 rounded-lg bg-gray-100" />
          <div className="h-40 rounded-lg bg-gray-100" />
        </div>
      </div>
    </main>
  );
}
