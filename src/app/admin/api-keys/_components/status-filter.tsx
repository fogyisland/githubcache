'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ReactElement } from 'react';

const OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'active', label: 'Active' },
  { value: 'revoked', label: 'Revoked' },
] as const;

export function StatusFilter({ current }: { current: string }): ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    const value = e.target.value;
    const params = new URLSearchParams(searchParams);
    if (value === 'all') {
      params.delete('status');
    } else {
      params.set('status', value);
    }
    router.push(`/admin/api-keys?${params.toString()}`);
  }

  return (
    <label>
      Filter:{' '}
      <select value={current} onChange={onChange}>
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}