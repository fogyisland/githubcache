import Link from 'next/link';

export default function RepoNotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 text-center">
      <h1 className="font-mono text-2xl font-bold text-gray-900">Repository not found</h1>
      <p className="mt-3 text-gray-600">
        That repo doesn&apos;t exist on GitHub (or is private and not accessible).
      </p>
      <p className="mt-6 text-sm">
        <Link href="/" className="text-blue-600 hover:text-blue-800">
          ← back to home
        </Link>
      </p>
    </main>
  );
}
