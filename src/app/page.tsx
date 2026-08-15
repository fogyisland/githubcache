export default function Home() {
  return (
    <main>
      <h1>GitHub Metadata Cache</h1>
      <p>
        Public query API: <code>POST /api/query</code> with an <code>X-API-Key</code> header.
      </p>
      <p>
        Health: <a href="/api/v1/status">/api/v1/status</a>
      </p>
    </main>
  );
}
