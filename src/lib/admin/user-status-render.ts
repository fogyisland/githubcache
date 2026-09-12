import { UserStatus } from '@/lib/db/users';

/**
 * Map a numeric User.status to its i18n key. The DB column is Int
 * (0=active, 2=disabled) but admin/user pages still display the
 * human-readable "active"/"disabled" labels from messages/*.json.
 *
 * Both en.json and zh.json have `admin.users.status.active` and
 * `admin.users.status.disabled`. Unknown values fall back to disabled
 * so a future-introduced status doesn't render an empty chip.
 */
export function userStatusI18nKey(status: number): 'status.active' | 'status.disabled' {
  return status === UserStatus.Active ? 'status.active' : 'status.disabled';
}

/**
 * Direct label getter (bypasses next-intl). Useful in tests + scripts
 * where the i18n runtime is not initialised.
 */
export function userStatusLabel(status: number): 'active' | 'disabled' {
  return status === UserStatus.Active ? 'active' : 'disabled';
}
