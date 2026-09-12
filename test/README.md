# test/

Ad-hoc load + smoke scripts that exercise the live API end-to-end. These
are NOT picked up by vitest (which uses `tests/`) — they're meant for
humans to verify behavior changes against a running `dev:server`.

Files:
- `load-50.mjs` — submits 50 GitHub repos and verifies the M31 no-stub
  semantics (pending response without a repositories row).
