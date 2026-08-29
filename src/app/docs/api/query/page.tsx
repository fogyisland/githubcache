import type { ReactElement } from 'react';
import { EndpointPage } from '../../_components/endpoint-page';
import { findEndpointBySlug } from '@/lib/api-docs/registry';

export default async function Page(): Promise<ReactElement> {
  const doc = findEndpointBySlug('api/query');
  if (!doc) throw new Error('endpoint doc missing');
  // Pre-await the async EndpointPage so its resolved React element is
  // returned, not a Promise (matches the recursive pre-await pattern from
  // M13.11; React rejects Promise-as-JSX-child).
  return await EndpointPage({ doc });
}
