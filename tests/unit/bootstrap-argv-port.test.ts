/**
 * Pins the `npm run start:5002` argv → process.env.PORT bridge.
 *
 * `src/bootstrap.ts` calls `applyPortFromArgv(process.argv, env)`
 * BEFORE zod reads `PORT`, so an operator-passed `--port <n>` wins
 * over .env / DEFAULT_DEV_PORT. The helper is extracted to
 * `src/lib/bootstrap-argv-port.ts` (pure, no next/react imports) so
 * these tests can pin the contract without booting Next.js.
 *
 * Pinning matters because:
 *   - Silent regression → operator runs `start:5002`, server listens
 *     on the default port, surprised.
 *   - Bad input (e.g. `--port abc`) must throw at boot, NOT fall
 *     back to default.
 */
import { describe, it, expect } from 'vitest';
import { applyPortFromArgv } from '@/lib/bootstrap-argv-port';

function freshEnv(): Record<string, string | undefined> {
  return {};
}

describe('applyPortFromArgv (start:5002 contract)', () => {
  describe('happy paths', () => {
    it('reads --port <n> after npm-style args', () => {
      // tsx passes through: [node, bootstrap.ts, --port, 5002]
      const env = freshEnv();
      applyPortFromArgv(['node', 'bootstrap.ts', '--port', '5002'], env);
      expect(env.PORT).toBe('5002');
    });

    it('reads -p <n> short form', () => {
      const env = freshEnv();
      applyPortFromArgv(['node', 'bootstrap.ts', '-p', '8080'], env);
      expect(env.PORT).toBe('8080');
    });

    it('reads --port=<n> equals form', () => {
      const env = freshEnv();
      applyPortFromArgv(['node', 'bootstrap.ts', '--port=5002'], env);
      expect(env.PORT).toBe('5002');
    });

    it('reads -p=<n> short equals form', () => {
      const env = freshEnv();
      applyPortFromArgv(['node', 'bootstrap.ts', '-p=9090'], env);
      expect(env.PORT).toBe('9090');
    });

    it('picks the first valid match and stops scanning', () => {
      const env = freshEnv();
      applyPortFromArgv(
        ['node', 'bootstrap.ts', '--port', '5002', '--port', '8080'],
        env,
      );
      expect(env.PORT).toBe('5002');
    });
  });

  describe('no-op cases', () => {
    it('does nothing when --port is absent', () => {
      const env = freshEnv();
      applyPortFromArgv(['node', 'bootstrap.ts'], env);
      expect(env.PORT).toBeUndefined();
    });

    it('does not match unrelated --portsomething flags', () => {
      // --portdebug should be left alone (only --port= / -p= with
      // exactly that prefix count, plus the spaced --port form).
      const env = freshEnv();
      applyPortFromArgv(['node', 'bootstrap.ts', '--portdebug', '5002'], env);
      expect(env.PORT).toBeUndefined();
    });

    it('does not match -path or other -p prefix flags', () => {
      const env = freshEnv();
      applyPortFromArgv(['node', 'bootstrap.ts', '-path', '5002'], env);
      expect(env.PORT).toBeUndefined();
    });
  });

  describe('invalid input → throw', () => {
    it('throws when --port has no following arg', () => {
      const env = freshEnv();
      expect(() =>
        applyPortFromArgv(['node', 'bootstrap.ts', '--port'], env),
      ).toThrow(/--port requires a 1-65535 integer/);
    });

    it('throws when --port value is non-numeric', () => {
      const env = freshEnv();
      expect(() =>
        applyPortFromArgv(['node', 'bootstrap.ts', '--port', 'abc'], env),
      ).toThrow(/--port requires a 1-65535 integer.*got 'abc'/);
    });

    it('throws when --port value is 0 (out of range)', () => {
      const env = freshEnv();
      expect(() =>
        applyPortFromArgv(['node', 'bootstrap.ts', '--port', '0'], env),
      ).toThrow(/--port requires a 1-65535 integer/);
    });

    it('throws when --port value exceeds 65535', () => {
      const env = freshEnv();
      expect(() =>
        applyPortFromArgv(['node', 'bootstrap.ts', '--port', '99999'], env),
      ).toThrow(/--port requires a 1-65535 integer/);
    });

    it('throws when --port=<n> value is non-numeric', () => {
      const env = freshEnv();
      expect(() =>
        applyPortFromArgv(['node', 'bootstrap.ts', '--port=abc'], env),
      ).toThrow(/--port=<n> requires a 1-65535 integer.*got 'abc'/);
    });

    it('throws when --port=<n> value is 65536 (boundary)', () => {
      const env = freshEnv();
      expect(() =>
        applyPortFromArgv(['node', 'bootstrap.ts', '--port=65536'], env),
      ).toThrow(/--port=<n> requires a 1-65535 integer/);
    });

    it('accepts 65535 as the boundary max', () => {
      const env = freshEnv();
      applyPortFromArgv(['node', 'bootstrap.ts', '--port', '65535'], env);
      expect(env.PORT).toBe('65535');
    });

    it('accepts 1 as the boundary min', () => {
      const env = freshEnv();
      applyPortFromArgv(['node', 'bootstrap.ts', '--port', '1'], env);
      expect(env.PORT).toBe('1');
    });
  });

  describe('precedence', () => {
    it('argv overrides a pre-existing PORT in env', () => {
      // Operator's `--port` wins over a stale .env PORT.
      const env: Record<string, string | undefined> = { PORT: '8080' };
      applyPortFromArgv(['node', 'bootstrap.ts', '--port', '5002'], env);
      expect(env.PORT).toBe('5002');
    });

    it('does NOT touch env.PORT when --port is absent', () => {
      // Caller's pre-existing env.PORT (e.g. from .env or systemd) is
      // preserved so the helper doesn't accidentally clobber it.
      const env: Record<string, string | undefined> = { PORT: '8080' };
      applyPortFromArgv(['node', 'bootstrap.ts'], env);
      expect(env.PORT).toBe('8080');
    });
  });
});
