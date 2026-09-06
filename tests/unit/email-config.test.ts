import { describe, expect, it, beforeEach, vi } from 'vitest';

const findUniqueMock = vi.fn();

vi.mock('@/lib/db/client', () => ({
  prisma: {
    emailConfig: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

import { getEmailConfig, publicConfigForUi, createEmailTransport } from '@/lib/email/config';

const SAMPLE_ROW = {
  id: 1,
  smtpHost: 'smtp.test',
  smtpPort: 587,
  smtpUser: 'user',
  smtpPass: 'SECRET_PASSWORD',
  smtpSecure: false,
  smtpFrom: 'from@test',
  replyTo: null,
  updatedAt: new Date(),
  updatedBy: null,
};

beforeEach(() => {
  findUniqueMock.mockReset();
});

describe('getEmailConfig', () => {
  it('returns configured:false when no row exists', async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    const cfg = await getEmailConfig();
    expect(cfg.configured).toBe(false);
    expect(cfg.row).toBeUndefined();
  });

  it('returns configured:true with row attached when present', async () => {
    findUniqueMock.mockResolvedValueOnce(SAMPLE_ROW);
    const cfg = await getEmailConfig();
    expect(cfg.configured).toBe(true);
    expect(cfg.smtpHost).toBe('smtp.test');
    expect(cfg.smtpPort).toBe(587);
    expect(cfg.row).toBe(SAMPLE_ROW);
  });

  it('publicConfigForUi drops the raw row', async () => {
    findUniqueMock.mockResolvedValueOnce(SAMPLE_ROW);
    const cfg = await getEmailConfig();
    const safe = publicConfigForUi(cfg);
    expect((safe as Record<string, unknown>)['row']).toBeUndefined();
    // Defense-in-depth — make sure no password substring leaks via JSON
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain('SECRET_PASSWORD');
  });

  it('returns null transport when not configured', async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    const cfg = await getEmailConfig();
    expect(createEmailTransport(cfg)).toBeNull();
  });
});
