import { describe, expect, it, beforeEach, vi } from 'vitest';

const sendEmailMock = vi.fn();
const buildDailyReportMock = vi.fn();
const findManyMock = vi.fn();

vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: {
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
  },
}));

vi.mock('@/lib/email/sender', () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

vi.mock('@/lib/email/reports/build-daily', () => ({
  buildDailyReport: (...args: unknown[]) => buildDailyReportMock(...args),
}));

import { runDailyReportTick } from '@/lib/scheduler/cron-daily-report';

beforeEach(() => {
  sendEmailMock.mockReset();
  buildDailyReportMock.mockReset();
  findManyMock.mockReset();
  sendEmailMock.mockResolvedValue({ ok: true, logId: 1n });
  buildDailyReportMock.mockResolvedValue({
    subject: 'daily',
    html: '<p>daily</p>',
    text: 'daily',
    data: {} as never,
  });
});

describe('runDailyReportTick', () => {
  it('skips outside the 00:00..00:04 UTC window', async () => {
    const noon = new Date(Date.UTC(2026, 8, 6, 12, 0, 0));
    await runDailyReportTick(noon);
    expect(findManyMock).not.toHaveBeenCalled();
    expect(buildDailyReportMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('skips at 00:05+ UTC even on the right minute boundary', async () => {
    const justPast = new Date(Date.UTC(2026, 8, 6, 0, 5, 0));
    await runDailyReportTick(justPast);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('runs in the 00:00..00:04 UTC window', async () => {
    const at = new Date(Date.UTC(2026, 8, 6, 0, 2, 0));
    findManyMock.mockResolvedValueOnce([
      { id: 1n, email: 'a@x' },
      { id: 2n, email: 'b@x' },
    ]);
    await runDailyReportTick(at);
    expect(findManyMock).toHaveBeenCalledTimes(1);
    expect(buildDailyReportMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    const toSet = new Set(sendEmailMock.mock.calls.map((c) => (c[0] as { to: string }).to));
    expect(toSet.has('a@x')).toBe(true);
    expect(toSet.has('b@x')).toBe(true);
  });

  it('skips when 0 active users', async () => {
    const at = new Date(Date.UTC(2026, 8, 6, 0, 2, 0));
    findManyMock.mockResolvedValueOnce([]);
    await runDailyReportTick(at);
    expect(buildDailyReportMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('builds report exactly once even for many users', async () => {
    const at = new Date(Date.UTC(2026, 8, 6, 0, 3, 0));
    findManyMock.mockResolvedValueOnce(
      Array.from({ length: 50 }).map((_, i) => ({ id: BigInt(i + 1), email: `u${i}@x` })),
    );
    await runDailyReportTick(at);
    expect(buildDailyReportMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(50);
  });

  it('does not crash when one send fails (allSettled)', async () => {
    const at = new Date(Date.UTC(2026, 8, 6, 0, 3, 0));
    findManyMock.mockResolvedValueOnce([
      { id: 1n, email: 'a@x' },
      { id: 2n, email: 'b@x' },
    ]);
    sendEmailMock
      .mockResolvedValueOnce({ ok: true, logId: 1n })
      .mockResolvedValueOnce({ ok: false, logId: 2n, error: 'fail' });
    await expect(runDailyReportTick(at)).resolves.toBeUndefined();
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
  });
});
