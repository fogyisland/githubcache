import { describe, expect, it } from 'vitest';
import { inviteTemplate } from '@/lib/email/templates/invite';
import { passwordResetTemplate } from '@/lib/email/templates/password-reset';
import { apiKeyApprovedTemplate } from '@/lib/email/templates/api-key-approved';
import { dailyReportTemplate } from '@/lib/email/templates/daily-report';
import { weeklyReportTemplate } from '@/lib/email/templates/weekly-report';
import type { Invitation, User } from '@prisma/client';

const SAMPLE_USER = {
  id: 1n,
  email: 'alice@example.com',
  passwordHash: 'x',
  role: 'admin',
  status: 'active',
  createdAt: new Date('2026-01-01'),
  lastLoginAt: new Date('2026-09-01'),
  theme: 'terminal',
  adminVariant: 'mission_control',
  lang: 'en',
  timezone: 'UTC',
} as unknown as User;

const SAMPLE_INVITATION = {
  id: 'abcdef0123456789abcdef0123456789',
  email: 'bob@example.com',
  role: 'operator',
  invitedBy: 1n,
  expiresAt: new Date('2026-12-01T00:00:00Z'),
  consumedAt: null,
  createdAt: new Date('2026-11-01'),
} as unknown as Invitation;

describe('email templates', () => {
  it('invite template includes inviter + accept URL + 7-day mention', () => {
    const t = inviteTemplate({
      inviter: 'admin@example.com',
      invitation: SAMPLE_INVITATION,
      acceptUrl: 'https://cache.example.com/request-access?invitation=abc',
      siteName: 'GitHub Metadata Cache',
    });
    expect(t.subject).toBe("You're invited to GitHub Metadata Cache");
    expect(t.html).toContain('admin@example.com');
    expect(t.html).toContain('/request-access?invitation=abc');
    expect(t.html).toContain('Accept invitation');
    expect(t.html).toContain('7 days');
    expect(t.text).toContain('admin@example.com');
    expect(t.text).toContain('/request-access?invitation=abc');
    expect(t.text).toContain('7 days');
  });

  it('password-reset template highlights tempPassword + warning', () => {
    const t = passwordResetTemplate({
      user: SAMPLE_USER,
      tempPassword: 'AbCdEfGhIjKlMnOp',
      loginUrl: 'https://cache.example.com/login',
      siteName: 'GitHub Metadata Cache',
    });
    expect(t.subject).toBe('Your GitHub Metadata Cache password was reset');
    expect(t.html).toContain('AbCdEfGhIjKlMnOp');
    expect(t.html).toContain('Important');
    expect(t.html).toContain('alice@example.com');
    expect(t.text).toContain('AbCdEfGhIjKlMnOp');
    expect(t.text).toContain('Important');
  });

  it('api-key-approved template includes plaintext key + treat-like-password warning', () => {
    const t = apiKeyApprovedTemplate({
      keyOwner: SAMPLE_USER,
      plaintextKey: 'ghc_abcd1234',
      apiKeyName: 'prod-key',
      siteName: 'GitHub Metadata Cache',
    });
    expect(t.subject).toBe('Your API key prod-key is approved');
    expect(t.html).toContain('ghc_abcd1234');
    expect(t.html).toContain('Treat this like a password');
    expect(t.html).toContain('prod-key');
    expect(t.text).toContain('ghc_abcd1234');
    expect(t.text).toContain('Treat this like a password');
  });

  it('daily-report template renders KPIs + repos', () => {
    const t = dailyReportTemplate({
      data: {
        dateLabel: '2026-09-05',
        windowStartUtc: '2026-09-05 00:00:00 UTC',
        windowEndUtc: '2026-09-06 00:00:00 UTC',
        totalRequests: 1234,
        cacheHitRate: 0.81,
        avgLatencyMs: 12,
        failedJobs24h: 2,
        topRepos: [{ repo: 'a/b', requestCount: 100, hitRate: 0.9 }],
        tokenQuotaUsage: [{ label: 'tok', requestsUsed: 100, requestsLimit: 5000 }],
      },
    });
    expect(t.subject).toContain('daily report');
    expect(t.html).toContain('1,234');
    expect(t.html).toContain('81.0%');
    expect(t.html).toContain('a/b');
    expect(t.html).toContain('tok');
    expect(t.text).toContain('1,234');
  });

  it('weekly-report template renders KPIs + top repos for 7-day window', () => {
    const t = weeklyReportTemplate({
      data: {
        dateLabel: '2026-09-05',
        windowStartUtc: '2026-08-30 00:00:00 UTC',
        windowEndUtc: '2026-09-06 00:00:00 UTC',
        totalRequests: 9000,
        cacheHitRate: 0.7,
        avgLatencyMs: 15,
        failed7d: 5,
        topRepos: [{ repo: 'c/d', requestCount: 500, hitRate: 0.6 }],
      },
    });
    expect(t.subject).toContain('weekly report');
    expect(t.html).toContain('9,000');
    expect(t.html).toContain('c/d');
    expect(t.html).toContain('(7d)');
    expect(t.text).toContain('9,000');
  });
});
