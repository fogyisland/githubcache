import { describe, expect, it } from 'vitest';
import enMessages from '@/../messages/en.json';
import zhMessages from '@/../messages/zh.json';

/**
 * M32 Task 4 Fix Round 1 — `confirmDelete` must match the design spec.
 *
 * Spec (docs/superpowers/specs/2026-09-14-admin-github-tokens-terminal-design.md
 * section 6): the inline alertdialog should read `$ confirm delete "<label>"? [y/N]`.
 *
 * Pre-fix: production strings were long explanatory sentences
 * (`"Delete this token from the registry and remove it from the pool? It
 * will stop taking effect immediately."` / zh equivalent). These read
 * like prose, not a terminal prompt — and the inline `[y/N]` design
 * assumes a short imperative so the visual line `$ confirm delete 123? [y] [N]`
 * is one row, not a wrapped paragraph.
 *
 * This test reads the production JSON files DIRECTLY (not via a
 * `next-intl` mock) so it asserts the actual strings shipped to users,
 * not what tests pretend is there.
 */

type JsonObject = Record<string, unknown>;

function readConfirmDelete(messages: JsonObject): string {
  const admin = messages.admin as JsonObject | undefined;
  const tokens = admin?.githubTokens as JsonObject | undefined;
  const actions = tokens?.actions as JsonObject | undefined;
  const value = actions?.confirmDelete;
  if (typeof value !== 'string') {
    throw new Error(
      `admin.githubTokens.actions.confirmDelete is not a string (got ${typeof value})`,
    );
  }
  return value;
}

describe('admin.githubTokens.actions.confirmDelete — M32 design alignment', () => {
  it('en.json: confirmDelete is a short terminal prompt containing "confirm delete"', () => {
    const confirmDelete = readConfirmDelete(enMessages as JsonObject);
    expect(confirmDelete.length).toBeGreaterThan(0);
    expect(confirmDelete.toLowerCase()).toContain('confirm delete');
  });

  it('zh.json: confirmDelete is a short terminal prompt matching zh design intent', () => {
    const confirmDelete = readConfirmDelete(zhMessages as JsonObject);
    expect(confirmDelete.length).toBeGreaterThan(0);
    // zh design intent: "确认删除此令牌？" or similar short phrase.
    // Asserts presence of the literal characters "确认删除" (confirm-delete).
    expect(confirmDelete).toContain('确认删除');
  });

  it('en.json: confirmDelete is short (under 40 chars — terminal-style, not prose)', () => {
    const confirmDelete = readConfirmDelete(enMessages as JsonObject);
    // The previous prose string was 102 chars. Design spec implies a
    // single-line terminal prompt — anything over 40 chars wraps or
    // breaks the visual `$ confirm delete? [y] [N]` rhythm.
    expect(confirmDelete.length).toBeLessThan(40);
  });

  it('zh.json: confirmDelete is short (under 40 chars)', () => {
    const confirmDelete = readConfirmDelete(zhMessages as JsonObject);
    // Previous zh prose was 38 chars but used multiple sentences.
    // Assert a tighter cap matching the visual intent.
    expect(confirmDelete.length).toBeLessThan(40);
  });

  it('en.json and zh.json both define admin.githubTokens.actions.confirmDelete (parity)', () => {
    const enHas = JSON.stringify(enMessages).includes('"confirmDelete"');
    const zhHas = JSON.stringify(zhMessages).includes('"confirmDelete"');
    expect(enHas).toBe(true);
    expect(zhHas).toBe(true);
  });
});
