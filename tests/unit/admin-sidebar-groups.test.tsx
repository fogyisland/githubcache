// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { usePathname } from 'next/navigation';
import { AdminSidebar } from '@/app/admin/_components/admin-sidebar';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/admin'),
}));

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => {
    const labels: Record<string, Record<string, string>> = {
      'admin.shell': {
        sidebarAria: 'Admin sections',
        'sections.dashboard': 'Dashboard',
        'sections.users': 'Users',
        'sections.api-keys': 'API Keys',
        'sections.github-tokens': 'GitHub Tokens',
        'sections.reports': 'Reports',
        'sections.queries': 'Queries',
        'sections.ingestion': 'Ingestion',
        'sections.providers': 'Providers',
        'sections.repositories': 'Imported nodes',
        'sections.audit': 'Audit',
        'sections.refresh': 'Refresh',
        'sections.queue': 'Queue',
        'sections.webhooks': 'Webhooks',
        'sections.database': 'Database',
        'sections.api-settings': 'API Settings',
        'sections.insights': 'Insights',
        'sections.email': 'Email',
        'sections.email-log': 'Email log',
      },
      'admin.shell.groups': {
        'overview.label': 'Overview',
        'access.label': 'Access',
        'data.label': 'Data',
        'operations.label': 'Operations',
        'system.label': 'System',
      },
      'admin.shell.groupToggle': {
        collapse: 'Collapse {group}',
        expand: 'Expand {group}',
      },
    };
    return (key: string, vars?: Record<string, string | number>) => {
      const v = labels[ns]?.[key];
      if (v && vars) return v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
      return v ?? key;
    };
  },
}));

describe('AdminSidebar — groups (M30.8)', () => {
  beforeEach(async () => {
    const { usePathname } = await import('next/navigation');
    vi.mocked(usePathname).mockReturnValue('/admin');
  });

  it('renders all 5 group containers with data-group attributes', () => {
    const html = renderToStaticMarkup(<AdminSidebar userRole="admin" />);
    expect(html).toContain('data-group="overview"');
    expect(html).toContain('data-group="access"');
    expect(html).toContain('data-group="data"');
    expect(html).toContain('data-group="operations"');
    expect(html).toContain('data-group="system"');
  });

  it('renders group labels in render order', () => {
    const html = renderToStaticMarkup(<AdminSidebar userRole="admin" />);
    // Assert each label appears in the expected order.
    const overviewIdx = html.indexOf('Overview');
    const accessIdx = html.indexOf('Access');
    const dataIdx = html.indexOf('Data');
    const operationsIdx = html.indexOf('Operations');
    const systemIdx = html.indexOf('System');
    expect(overviewIdx).toBeGreaterThan(-1);
    expect(accessIdx).toBeGreaterThan(overviewIdx);
    expect(dataIdx).toBeGreaterThan(accessIdx);
    expect(operationsIdx).toBeGreaterThan(dataIdx);
    expect(systemIdx).toBeGreaterThan(operationsIdx);
  });

  it('hides admin-only groups from operators', () => {
    const html = renderToStaticMarkup(<AdminSidebar userRole="operator" />);
    // overview, access, data are operator-visible.
    expect(html).toContain('data-group="overview"');
    expect(html).toContain('data-group="access"');
    expect(html).toContain('data-group="data"');
    // operations and system are admin-only.
    expect(html).not.toContain('data-group="operations"');
    expect(html).not.toContain('data-group="system"');
  });

  it('hides admin-only sections within visible groups from operators', () => {
    const html = renderToStaticMarkup(<AdminSidebar userRole="operator" />);
    // `access` group is operator-visible but `users` is admin-only.
    expect(html).toContain('data-group="access"');
    expect(html).not.toContain('href="/admin/users"');
    // `data` group is operator-visible but `ingestion` and `providers` are admin-only.
    expect(html).toContain('data-group="data"');
    expect(html).not.toContain('href="/admin/ingestion"');
    expect(html).not.toContain('href="/admin/providers"');
  });

  it('renders each group\'s sections in the order declared by ADMIN_GROUPS', () => {
    const html = renderToStaticMarkup(<AdminSidebar userRole="admin" />);
    // Spot-check the `operations` group order: refresh, queue, webhooks, audit.
    const refreshIdx = html.indexOf('href="/admin/refresh"');
    const queueIdx = html.indexOf('href="/admin/queue"');
    const webhooksIdx = html.indexOf('href="/admin/webhooks"');
    const auditIdx = html.indexOf('href="/admin/audit"');
    expect(refreshIdx).toBeGreaterThan(-1);
    expect(queueIdx).toBeGreaterThan(refreshIdx);
    expect(webhooksIdx).toBeGreaterThan(queueIdx);
    expect(auditIdx).toBeGreaterThan(webhooksIdx);
  });

  it('group header is a button with aria-expanded + aria-controls', () => {
    const html = renderToStaticMarkup(<AdminSidebar userRole="admin" />);
    // The overview group's header is a <button> with aria-expanded
    // pointing at a controlled list. Overview is force-expanded because
    // the active section (`dashboard`) lives there.
    expect(html).toMatch(
      /<button[^>]*aria-expanded="true"[^>]*aria-controls="ghc-admin-sidebar-group-overview"/,
    );
  });
});

/**
 * M30.8 — collapse/expand + active-group force-expand interaction tests.
 *
 * DOM library chosen: `react-dom/client` (`createRoot(...).render(...)`)
 * + raw `button.dispatchEvent(new MouseEvent('click', { bubbles: true }))`.
 *
 * `@testing-library/react` is NOT a direct or transitive dependency in
 * this repo (verified in Task 6 report), so we use the only DOM-binding
 * option that does not require adding a new package. happy-dom provides
 * `window` and `document` under `// @vitest-environment` above.
 *
 * NOTE: vitest's `happy-dom` environment ships `window.localStorage` as
 * a plain object stub (no `getItem`/`setItem`/`clear` methods — see the
 * `--localstorage-file was provided without a valid path` warning).
 * `installInMemoryLocalStorage()` below swaps it for a Map-backed
 * implementation that matches the Storage interface our component
 * reads/writes. The component itself wraps these calls in `try/catch`
 * so a missing Storage would not crash, but tests 2 & 3 explicitly
 * verify the persisted JSON, so the stub is required.
 *
 * Each test renders into its own fresh `<div>` and unmounts via
 * `root.unmount()` so the next test sees a clean DOM (in particular,
 * `localStorage` is cleared in `beforeEach` for state isolation).
 */

/** Map-backed Storage stub. Mirrors the parts of Storage we exercise. */
function installInMemoryLocalStorage(): void {
  const store = new Map<string, string>();
  const stub = {
    get length(): number {
      return store.size;
    },
    clear(): void {
      store.clear();
    },
    getItem(key: string): string | null {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number): string | null {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    setItem(key: string, value: string): void {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: stub,
  });
}

describe('AdminSidebar — collapse / expand interaction', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    installInMemoryLocalStorage();
    window.localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root.unmount();
      });
    }
    if (container && container.parentNode) {
      container.remove();
    }
  });

  it('clicking a non-active group header collapses its items', () => {
    // The brief's draft used `[data-group="overview"]`, but `overview`
    // is force-expanded when the active pathname is `/admin` (the
    // dashboard section lives there) — see `isCurrentGroupActive()` in
    // admin-sidebar.tsx. So clicking its header toggles `collapsed` but
    // `isExpanded()` still returns true. Use the `access` group instead,
    // which has no active section under `/admin`.
    act(() => {
      root.render(<AdminSidebar userRole="admin" />);
    });
    const accessList = container.querySelector('#ghc-admin-sidebar-group-access');
    expect(accessList).not.toBeNull();
    expect(accessList!.hasAttribute('hidden')).toBe(false);
    const accessHeader = container.querySelector(
      '[data-group="access"] button',
    ) as HTMLButtonElement | null;
    expect(accessHeader).not.toBeNull();
    act(() => {
      accessHeader!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const accessListAfter = container.querySelector(
      '#ghc-admin-sidebar-group-access',
    );
    expect(accessListAfter!.hasAttribute('hidden')).toBe(true);
  });

  it('persists collapsed state in localStorage', () => {
    act(() => {
      root.render(<AdminSidebar userRole="admin" />);
    });
    const accessHeader = container.querySelector(
      '[data-group="access"] button',
    ) as HTMLButtonElement | null;
    expect(accessHeader).not.toBeNull();
    act(() => {
      accessHeader!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const stored = JSON.parse(
      window.localStorage.getItem('ghc.admin.sidebar.collapsed') ?? '{}',
    );
    expect(stored.access).toBe(true);
  });

  it('re-expanding a group clears its entry from localStorage (or sets false)', () => {
    act(() => {
      root.render(<AdminSidebar userRole="admin" />);
    });
    const accessHeader = container.querySelector(
      '[data-group="access"] button',
    ) as HTMLButtonElement | null;
    expect(accessHeader).not.toBeNull();
    act(() => {
      accessHeader!.dispatchEvent(new MouseEvent('click', { bubbles: true })); // collapse
    });
    act(() => {
      accessHeader!.dispatchEvent(new MouseEvent('click', { bubbles: true })); // re-expand
    });
    const stored = JSON.parse(
      window.localStorage.getItem('ghc.admin.sidebar.collapsed') ?? '{}',
    );
    expect(stored.access).not.toBe(true);
  });

  it('force-expands the group containing the active section', () => {
    // Pathname is /admin/email/log — the active section is `email-log` which
    // lives in the `system` group. Even after attempting to collapse
    // `system`, the items must remain visible because the active
    // section lives there.
    //
    // Per the brief's "Replace the `vi.doMock` block..." note, we use the
    // established `vi.mocked(usePathname).mockReturnValue(...)` pattern
    // instead of `vi.doMock` (which is brittle across tests).
    vi.mocked(usePathname).mockReturnValue('/admin/email/log');
    act(() => {
      root.render(<AdminSidebar userRole="admin" />);
    });
    const systemHeader = container.querySelector(
      '[data-group="system"] button',
    ) as HTMLButtonElement | null;
    expect(systemHeader).not.toBeNull();
    act(() => {
      systemHeader!.dispatchEvent(new MouseEvent('click', { bubbles: true })); // attempt to collapse
    });
    const systemList = container.querySelector('#ghc-admin-sidebar-group-system');
    expect(systemList).not.toBeNull();
    expect(systemList!.hasAttribute('hidden')).toBe(false); // still visible
  });
});
