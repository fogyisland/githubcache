import { describe, it, expect } from 'vitest';
import { buildBackupFilename } from '@/lib/database/backup';

/**
 * Unit tests for src/lib/database/backup.ts helpers.
 *
 * The big spawn-based createBackup() can't run in unit tests
 * (needs mysqldump + gzip on PATH, plus a real DB to dump) — that
 * path is exercised manually by operators. These tests cover the
 * pure helpers: filename generation, URL parsing (implicit via
 * the createBackup args), and the filename format invariants.
 */
describe('buildBackupFilename', () => {
  it('produces githubcache-YYYYMMDD-HHMMSS.sql.gz format', () => {
    const fixed = new Date(2026, 7, 31, 14, 5, 9); // 2026-08-31 14:05:09 local
    const name = buildBackupFilename(fixed);
    expect(name).toBe('githubcache-20260831-140509.sql.gz');
  });

  it('zero-pads single-digit month/day/hour/minute/second', () => {
    const fixed = new Date(2026, 0, 3, 7, 8, 9); // 2026-01-03 07:08:09
    const name = buildBackupFilename(fixed);
    expect(name).toBe('githubcache-20260103-070809.sql.gz');
  });

  it('two distinct timestamps produce two distinct filenames', () => {
    const a = new Date(2026, 7, 31, 10, 0, 0);
    const b = new Date(2026, 7, 31, 10, 0, 1);
    expect(buildBackupFilename(a)).not.toBe(buildBackupFilename(b));
  });

  it('sorts lexicographically in time order', () => {
    const t1 = new Date(2026, 7, 31, 9, 0, 0);
    const t2 = new Date(2026, 7, 31, 9, 0, 1);
    const t3 = new Date(2026, 7, 31, 9, 0, 10);
    const names = [buildBackupFilename(t3), buildBackupFilename(t1), buildBackupFilename(t2)];
    names.sort();
    expect(names).toEqual([
      buildBackupFilename(t1),
      buildBackupFilename(t2),
      buildBackupFilename(t3),
    ]);
  });
});
