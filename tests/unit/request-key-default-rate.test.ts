import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * requestKey() 默认 rateLimitPerMin 应该从 PUBLIC_REPO_RATE_PER_HOUR 自动推导。
 *
 * 背景：用户希望"API Key 申请时的 60/min 默认值"跟 /admin/api-settings
 * 设置界面里的 PUBLIC_REPO_RATE_PER_HOUR 保持一致。所以新 key 申请的
 * rateLimitPerMin = ceil(PUBLIC_REPO_RATE_PER_HOUR / 60)。
 *
 * dailyQuota 保持 schema 默认 (10000) — 不跟 API 设置界面联动，因为它是
 * 日累计配额，跟 per-hour 限速不在一个维度。
 *
 * 测试隔离策略：vi.mock 替换 env 模块以控制 PUBLIC_REPO_RATE_PER_HOUR
 * 值；mock @/lib/db/api-keys 的 createApiKeyRow 拦截写入，记录传入的
 * rateLimitPerMin / dailyQuota 字段。这样测的是 workflow 函数本身的
 * 行为（不是 Prisma 写入）。
 */

const mockCreateApiKeyRow = vi.fn();
const mockWriteAudit = vi.fn();

vi.mock('@/lib/db/api-keys', () => ({
  createApiKeyRow: mockCreateApiKeyRow,
  findApiKeyById: vi.fn(),
  updateApiKeyById: vi.fn(),
  updateApiKeyByIdUnchecked: vi.fn(),
}));

vi.mock('@/lib/audit/writer', () => ({
  writeAudit: mockWriteAudit,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Default PUBLIC_REPO_RATE_PER_HOUR for most tests. Tests that need a
// different value set it via vi.resetModules + process.env override.
const DEFAULT_HOURLY = 50_000;

vi.mock('@/lib/config/env', () => ({
  env: {
    PUBLIC_REPO_RATE_PER_HOUR: DEFAULT_HOURLY,
  },
}));

describe('requestKey default rate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateApiKeyRow.mockResolvedValue({
      id: 1n,
      userId: 1n,
      name: 'k',
      keyPrefix: 'pending',
      keyHash: 'h',
      status: 'pending',
      rateLimitPerMin: 0,
      dailyQuota: 0,
      createdAt: new Date(),
      approvedAt: null,
      approvedBy: null,
      revokedAt: null,
      revokedBy: null,
      description: null,
      lastUsedAt: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses ceil(PUBLIC_REPO_RATE_PER_HOUR / 60) as rateLimitPerMin', async () => {
    // 50_000 / 60 = 833.33... → ceil = 834
    const { requestKey } = await import('@/lib/api-keys/workflow');
    await requestKey({ userId: 1n, name: 'k1' });

    expect(mockCreateApiKeyRow).toHaveBeenCalledTimes(1);
    const arg = mockCreateApiKeyRow.mock.calls[0]![0];
    expect(arg.rateLimitPerMin).toBe(Math.ceil(50_000 / 60));
    expect(arg.rateLimitPerMin).toBe(834);
  });

  it('preserves dailyQuota schema default (10000)', async () => {
    const { requestKey } = await import('@/lib/api-keys/workflow');
    await requestKey({ userId: 1n, name: 'k1' });

    const arg = mockCreateApiKeyRow.mock.calls[0]![0];
    expect(arg.dailyQuota).toBe(10000);
  });

  it('rateLimitPerMin stays >= 1 even for tiny PUBLIC_REPO_RATE_PER_HOUR', async () => {
    // Edge case: PUBLIC_REPO_RATE_PER_HOUR=30 → 30/60 = 0.5 → ceil = 1
    vi.resetModules();
    vi.doMock('@/lib/config/env', () => ({
      env: { PUBLIC_REPO_RATE_PER_HOUR: 30 },
    }));
    const { requestKey } = await import('@/lib/api-keys/workflow');
    await requestKey({ userId: 1n, name: 'k-edge' });

    const arg = mockCreateApiKeyRow.mock.calls[0]![0];
    expect(arg.rateLimitPerMin).toBeGreaterThanOrEqual(1);
    expect(arg.rateLimitPerMin).toBe(1);
  });

  it('rateLimitPerMin scales with PUBLIC_REPO_RATE_PER_HOUR (12000/h → 200/min)', async () => {
    vi.resetModules();
    vi.doMock('@/lib/config/env', () => ({
      env: { PUBLIC_REPO_RATE_PER_HOUR: 12_000 },
    }));
    const { requestKey } = await import('@/lib/api-keys/workflow');
    await requestKey({ userId: 1n, name: 'k-scale' });

    const arg = mockCreateApiKeyRow.mock.calls[0]![0];
    // 12_000 / 60 = 200 exactly
    expect(arg.rateLimitPerMin).toBe(200);
  });
});