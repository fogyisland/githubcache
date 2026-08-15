# GitHub Metadata Cache

A Node.js + Next.js service that caches GitHub repository metadata behind a public query API, with a multi-token pool, background refresh scheduler, and admin panel.

## Status

This project is under active development. See `docs/superpowers/` for the design spec, implementation strategy, and implementation plan.

## 5-minute startup

1. Clone the repo (or `cd` into an existing checkout).
2. `cp .env.example .env` and fill in `DATABASE_URL` and `SESSION_SECRET`.
3. `pnpm install`
4. `pnpm dev`
5. In another terminal: `curl http://localhost:3000/api/v1/status` — expect `{"ok":true,"db":"up","tokens":{"active":0,"exhausted":0}}`.
6. Open `http://localhost:3000/` for the landing page.

## Scripts

- `pnpm dev` — start Next.js dev server on port 3000
- `pnpm build` — production build
- `pnpm start` — start production server
- `pnpm typecheck` — TypeScript strict mode check
- `pnpm lint` — ESLint
- `pnpm format` — Prettier check (does not modify files)
- `pnpm format:write` — Prettier write
- `pnpm test` — Vitest unit tests

## Layout

- `src/app/` — Next.js App Router pages and API routes
- `src/lib/` — framework-agnostic business logic (no Next imports)
- `tests/unit/` — Vitest unit tests
- `tests/integration/` — Vitest route-level tests
- `docs/superpowers/specs/` — design documents
- `docs/superpowers/plans/` — implementation plans

## License

Internal / TBD.
