import { describe, expect, it, beforeEach, vi } from 'vitest';

const sendEmailMock = vi.fn();
const buildWeeklyReportMock = vi.fn();
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

vi.mock('@/lib/email/reports/build-weekly', () => ({
  buildWeeklyReport: (...args: unknown[]) => buildWeeklyReportMock(...args),
}));

import { runWeeklyReportTick } from '@/lib/scheduler/cron-weekly-report';

beforeEach(() => {
  sendEmailMock.mockReset();
  buildWeeklyReportMock.mockReset();
  findManyMock.mockReset();
  sendEmailMock.mockResolvedValue({ ok: true, logId: 1n });
  buildWeeklyReportMock.mockResolvedValue({
    subject: 'weekly',
    html: '<p>weekly</p>',
    text: 'weekly',
    data: {} as never,
  });
});

describe('runWeeklyReportTick', () => {
  it('skips on non-Monday in the 00:10..00:14 window', async () => {
    // 2026-09-08 is a Tuesday
    const t = new Date(Date.UTC(2026, 8, 8, 0, 12, 0));
    await runWeeklyReportTick(t);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('skips Monday outside the 00:10..00:14 window', async () => {
    // 2026-09-07 is a Monday at 00:09
    const t = new Date(Date.UTC(2026, 8, 7, 0, 9, 0));
    await runWeeklyReportTick(t);
    expect(findManyMock).not.toHaveBeenCalled();
    const t2 = new Date(Date.UTC(2026, 8, 7, 0, 15, 0));
    await runWeeklyReportTick(t2);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('runs on Monday 00:10..00:14 UTC', async () => {
    const t = new Date(Date.UTC(2026, 8, 7, 0, 12, 0));
    findManyMock.mockResolvedValueOnce([{ id: 1n, email: 'a@x' }]);
    await runWeeklyReportTick(t);
    expect(findManyMock).toHaveBeenCalledTimes(1);
    expect(buildWeeklyReportMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0]![0]).toMatchObject({
      templateKey: 'weekly-report',
      to: 'a@x',
    });
  });

  it('skips with 0 active users', async () => {
    const t = new Date(Date.UTC(2026, 8, 7, 0, 12, 0));
    findManyMock.mockResolvedValueOnce([]);
    await runWeeklyReportTick(t);
    expect(buildWeeklyReportMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
