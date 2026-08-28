import { describe, it, expect } from 'vitest';
import { v1StatusSchema, v1StatusSample } from '@/lib/api-docs/schemas/v1-status';

describe('v1-status schema', () => {
  it('validates a complete status payload', () => {
    const result = v1StatusSchema.safeParse(v1StatusSample);
    expect(result.success).toBe(true);
  });
  it('flags missing required field `ok`', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { ok, ...rest } = v1StatusSample;
    expect(v1StatusSchema.safeParse(rest).success).toBe(false);
  });
});