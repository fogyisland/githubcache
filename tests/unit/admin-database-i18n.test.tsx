import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

function flattenDict(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix === '' ? k : `${prefix}.${k}`;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenDict(v as Record<string, unknown>, path));
    } else {
      out[path] = String(v);
    }
  }
  return out;
}

const databaseDict = flattenDict({
  title: 'Database',
  description:
    'Inspect DB version + size, take local backups, restore from a backup file, browse table schemas, and view top slow queries.',
  breadcrumb: { admin: 'Admin', database: 'Database' },
  binaryWarning: {
    heading: 'Backup binaries missing',
    mysqldump: 'mysqldump not found on PATH.',
    gzip: 'gzip not found on PATH.',
    hint: 'Install hint.',
    installHint: 'Install command.',
  },
  overview: {
    heading: 'Overview',
    version: 'Version',
    host: 'Host',
    database: 'Database',
    port: 'Port',
    tableCount: 'Tables',
    totalBytes: 'Disk usage',
    bytesUnknown: 'unknown',
  },
  backup: {
    heading: 'Backups',
    createButton: 'Back up now',
    creating: 'Backing up…',
    createSuccess: 'Backup saved as {filename} ({size}).',
    createFailed: 'Backup failed: {error}',
    listEmpty: 'No backups yet.',
    listHeader: 'Existing backups',
    downloadLabel: 'Download',
    size: 'Size',
    mtime: 'Created',
    deleteLabel: 'Delete',
    deleteConfirm: 'Delete {filename}?',
    retentionHint: 'Retention: most recent {keep} kept.',
  },
  restore: {
    heading: 'Restore',
    fromBackup: 'Restore from existing backup',
    fromUpload: 'Restore from uploaded .sql.gz',
    uploadLabel: 'Choose .sql.gz file',
    uploadHelp: 'Max {max}.',
    selectBackup: 'Pick a backup…',
    confirmPrompt: 'Type RESTORE',
    confirmPlaceholder: 'RESTORE',
    submitButton: 'Restore database',
    submitting: 'Restoring…',
    resultSuccess: 'Restore complete. {tables} tables. {filename}.',
    resultFailed: 'Restore failed: {error}',
    resultRolledBack: 'Restore rolled back. {error}',
    warning: 'Restoring overwrites the current database.',
  },
  tables: {
    heading: 'Tables',
    column: { model: 'Model', table: 'Table', rows: 'Rows', size: 'Size', columns: 'Columns', indexes: 'Indexes' },
    expand: 'Show schema',
    collapse: 'Hide schema',
    indexesEmpty: 'no indexes',
    primaryKey: 'PK',
    notNull: 'NN',
  },
  slowQueries: {
    heading: 'Slow queries (top {limit})',
    noPermission: 'No permission: {reason}',
    empty: 'No statements yet.',
    column: { calls: 'Calls', total: 'Total', avg: 'Avg', rowsSent: 'Rows sent', sample: 'Sample' },
  },
  prismaStudio: {
    heading: 'Prisma Studio',
    description: 'Run prisma studio.',
    command: 'npx prisma studio',
    openDocs: 'Open docs →',
  },
});

function lookup(ns: string, key: string): string {
  const relPrefix = ns.startsWith('admin.database.') ? ns.slice('admin.database.'.length) : '';
  if (relPrefix) {
    const nested = `${relPrefix}.${key}`;
    const v = databaseDict[nested];
    if (v !== undefined) return v;
  }
  const full = ns + '.' + key;
  const fullV = databaseDict[full];
  if (fullV !== undefined) return fullV;
  const rootV = databaseDict[key];
  if (rootV !== undefined) return rootV;
  return key;
}

vi.mock('next-intl/server', () => ({
  getTranslations: async (ns: string) => (key: string) => lookup(ns, key),
}));

vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [] }),
}));

vi.mock('@/lib/auth/session', () => ({
  validateSession: async () => ({
    id: 1n,
    email: 'admin@test.com',
    role: 'admin',
    status: 'active',
    adminVariant: 'mission_control',
    theme: 'terminal',
    createdAt: new Date('2026-01-01'),
    lastLoginAt: null,
    passwordHash: '',
  }),
}));

vi.mock('@/lib/database/overview', () => ({
  getDatabaseOverview: async () => ({
    version: '8.0.36',
    databaseName: 'githubcache',
    host: '127.0.0.1',
    port: 3306,
    totalBytes: 1024 * 1024 * 50,
    tableCount: 13,
  }),
  getTableStats: async () => [
    { model: 'Repository', table: 'repositories', rowCount: 100, bytes: 1024 * 1024 },
    { model: 'User', table: 'users', rowCount: 5, bytes: 1024 },
  ],
}));

vi.mock('@/lib/database/tables', () => ({
  getTableDetails: async () => [
    {
      table: 'repositories',
      rowCount: 100,
      bytes: 1024 * 1024,
      columns: [{ name: 'id', dataType: 'bigint', nullable: false, isPrimaryKey: true }],
      indexes: [{ name: 'PRIMARY', columns: ['id'], unique: true }],
    },
  ],
}));

vi.mock('@/lib/database/slow-queries', () => ({
  topSlowQueries: async () => ({
    kind: 'ok' as const,
    rows: [
      {
        digest: 'ABC',
        calls: 10,
        totalSeconds: 0.5,
        avgSeconds: 0.05,
        rowsSent: 50,
        sampleSql: 'SELECT 1',
      },
    ],
  }),
}));

vi.mock('@/lib/database/backup', () => ({
  listBackups: async () => [
    { filename: 'githubcache-20260831-100000.sql.gz', size: 1024, mtime: new Date('2026-08-31T10:00:00Z') },
  ],
}));

vi.mock('@/lib/database/binary-check', () => ({
  getBinaryStatus: () => ({
    mysqldump: { available: true, version: '10.4' },
    gzip: { available: true, version: '1.13' },
  }),
  binariesReady: () => true,
}));

vi.mock('@/app/admin/_components/admin-page-header', () => ({
  AdminPageHeader: ({ title, description }: { title: string; description?: string }) =>
    createElement(
      'div',
      { 'data-testid': 'page-header-stub' },
      createElement('h1', null, title),
      description ? createElement('p', null, description) : null,
    ),
}));

vi.mock('@/app/admin/database/_components/binary-warning', () => ({
  BinaryWarning: () => createElement('div', { 'data-testid': 'binary-warning-stub' }),
}));

vi.mock('@/app/admin/database/_components/backup-section', () => ({
  BackupSection: () => createElement('div', { 'data-testid': 'backup-section-stub' }),
}));

vi.mock('@/app/admin/database/_components/restore-section', () => ({
  RestoreSection: ({ backups }: { backups: Array<{ filename: string }> }) =>
    createElement(
      'div',
      { 'data-testid': 'restore-section-stub', 'data-count': String(backups.length) },
    ),
}));

vi.mock('@/app/admin/database/_components/slow-queries-section', () => ({
  SlowQueriesSection: () => createElement('div', { 'data-testid': 'slow-queries-stub' }),
}));

vi.mock('@/app/admin/database/_components/prisma-studio-link', () => ({
  PrismaStudioLink: () =>
    createElement('div', { 'data-testid': 'prisma-studio-stub' }, 'Prisma Studio stub'),
}));

// Overview is an async server component in production. The mock must
// return a plain (sync) React element because renderToStaticMarkup
// does not support nested async components.
vi.mock('@/app/admin/database/_components/overview', () => ({
  Overview: () =>
    createElement(
      'div',
      { 'data-testid': 'overview-stub' },
      createElement('span', { 'data-version': '8.0.36' }, '8.0.36'),
    ),
}));

// TablesSection is a client component — mock it synchronously.
vi.mock('@/app/admin/database/_components/tables-section', () => ({
  TablesSection: () => createElement('div', { 'data-testid': 'tables-stub' }),
}));

import AdminDatabasePage from '@/app/admin/database/page';

describe('AdminDatabasePage i18n', () => {
  it('renders translated title and description on the page header', async () => {
    const html = renderToStaticMarkup(await AdminDatabasePage());
    expect(html).toContain('Database');
    expect(html).toContain(
      'Inspect DB version + size, take local backups, restore from a backup file, browse table schemas, and view top slow queries.',
    );
  });

  it('does NOT render the binary warning when binaries are ready', async () => {
    const html = renderToStaticMarkup(await AdminDatabasePage());
    expect(html).not.toContain('data-testid="binary-warning-stub"');
  });

  it('renders the section stubs together', async () => {
    const html = renderToStaticMarkup(await AdminDatabasePage());
    expect(html).toContain('data-testid="overview-stub"');
    expect(html).toContain('data-testid="backup-section-stub"');
    expect(html).toContain('data-testid="restore-section-stub"');
    expect(html).toContain('data-testid="tables-stub"');
    expect(html).toContain('data-testid="slow-queries-stub"');
    expect(html).toContain('data-testid="prisma-studio-stub"');
  });
});
