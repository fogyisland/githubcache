import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression guard for the "list-page row copy key" feature (M31.x).
 *
 * Why this exists:
 *   /account/keys exposes a "copy" button that calls revealKeyAction.
 *   revealKeyAction returns the row's `api_keys.plaintext_key` column.
 *   If someone removes the column, or changes the column shape, the
 *   feature silently breaks (action throws at runtime; user sees a
 *   blank toast). This test pins the column shape so the breakage is
 *   loud.
 *
 * What it checks:
 *   1. `model ApiKey` declares a `plaintextKey` field.
 *   2. The field is `String?` (nullable — existing keys have no
 *      plaintext; only newly created/rotated keys get it).
 *   3. The field is mapped to `plaintext_key` in MySQL (snake_case).
 */
describe('ApiKey plaintext_key column', () => {
  const schema = readFileSync(
    resolve(import.meta.dirname, '../../prisma/schema.prisma'),
    'utf8',
  );

  it('ApiKey model declares a plaintextKey field', () => {
    const apiKeyBlock = schema.match(/model\s+ApiKey\s*\{([\s\S]*?)\n\}/);
    expect(apiKeyBlock).not.toBeNull();
    if (!apiKeyBlock) return;
    const body = apiKeyBlock[1]!;
    expect(body).toMatch(/plaintextKey\s+String\?\s+@map\("plaintext_key"\)/);
  });

  it('plaintextKey is optional (nullable) — existing rows without plaintext must remain valid', () => {
    const apiKeyBlock = schema.match(/model\s+ApiKey\s*\{([\s\S]*?)\n\}/);
    expect(apiKeyBlock).not.toBeNull();
    if (!apiKeyBlock) return;
    const body = apiKeyBlock[1]!;
    const line = body.split('\n').find((l) => l.includes('plaintextKey'));
    expect(line).toBeDefined();
    expect(line).toMatch(/String\?/);
  });
});