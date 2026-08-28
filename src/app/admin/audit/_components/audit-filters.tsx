'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

// Hard-coded list of known audit actions. Stable for M7.5; if a new action
// is added elsewhere in the codebase, this list should be updated too.
// Keep in sync with `action:` strings in src/app/api/admin/**/route.ts.
const ACTIONS = [
  '', // empty = all
  'login_success',
  'login_failed',
  'login_throttled',
  'logout',
  'password_changed',
  'invite_user',
  'disable_user',
  'enable_user',
  'logout_all_sessions',
  'reset_password',
  'change_key_limits',
  'request_key',
  'approve_key',
  'revoke_key',
  'register_token',
  'disable_token',
  'enable_token',
  'delete_token',
  'manual_refresh_trigger',
  'scheduler_paused',
  'scheduler_resumed',
  'repo_forbidden',
  'refresh.failed_review',
];

const TARGET_TYPES = ['', 'session', 'user', 'invitation', 'api_key', 'github_token'];

/**
 * URL-based filter UI for the audit log page. The page itself is a server
 * component and reads `searchParams` from the URL; this client component
 * updates the URL on submit.
 */
export function AuditFilters() {
  const t = useTranslations('admin.audit.filters');
  const router = useRouter();
  const params = useSearchParams();
  const [action, setAction] = useState(params.get('action') ?? '');
  const [actorUserId, setActorUserId] = useState(params.get('actorUserId') ?? '');
  const [targetType, setTargetType] = useState(params.get('targetType') ?? '');
  const [from, setFrom] = useState(params.get('from') ?? '');
  const [to, setTo] = useState(params.get('to') ?? '');

  function apply(): void {
    const u = new URL(window.location.href);
    const p = u.searchParams;
    p.delete('offset'); // reset pagination on filter change
    if (action) p.set('action', action); else p.delete('action');
    if (actorUserId) p.set('actorUserId', actorUserId); else p.delete('actorUserId');
    if (targetType) p.set('targetType', targetType); else p.delete('targetType');
    if (from) p.set('from', from); else p.delete('from');
    if (to) p.set('to', to); else p.delete('to');
    router.push(u.pathname + '?' + p.toString());
  }

  function reset(): void {
    setAction(''); setActorUserId(''); setTargetType(''); setFrom(''); setTo('');
    router.push('/admin/audit');
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="flex flex-col text-sm">
          <span className="text-gray-600">{t('action')}</span>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="mt-1 rounded border border-gray-300 px-2 py-1"
          >
            {ACTIONS.map((a) => (
              <option key={a} value={a}>{a || t('anyOption')}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col text-sm">
          <span className="text-gray-600">{t('actorUserId')}</span>
          <input
            type="text"
            value={actorUserId}
            onChange={(e) => setActorUserId(e.target.value)}
            placeholder={t('actorUserIdPlaceholder')}
            className="mt-1 rounded border border-gray-300 px-2 py-1"
          />
        </label>

        <label className="flex flex-col text-sm">
          <span className="text-gray-600">{t('targetType')}</span>
          <select
            value={targetType}
            onChange={(e) => setTargetType(e.target.value)}
            className="mt-1 rounded border border-gray-300 px-2 py-1"
          >
            {TARGET_TYPES.map((tt) => (
              <option key={tt} value={tt}>{tt || t('anyOption')}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col text-sm">
          <span className="text-gray-600">{t('from')}</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 rounded border border-gray-300 px-2 py-1"
          />
        </label>

        <label className="flex flex-col text-sm">
          <span className="text-gray-600">{t('to')}</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 rounded border border-gray-300 px-2 py-1"
          />
        </label>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={apply}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {t('apply')}
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {t('reset')}
        </button>
      </div>
    </div>
  );
}
