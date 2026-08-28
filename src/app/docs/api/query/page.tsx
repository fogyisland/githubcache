import type { ReactElement } from 'react';
import { EndpointPage } from '../../_components/endpoint-page';
import { findEndpointBySlug } from '@/lib/api-docs/registry';

export default async function Page(): Promise<ReactElement> {
  const doc = findEndpointBySlug('api/query');
  if (!doc) throw new Error('endpoint doc missing');
  return <EndpointPage doc={doc} />;
}
