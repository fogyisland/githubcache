import type { ReactElement } from 'react';
import { EndpointPage } from '../../_components/endpoint-page';
import { findEndpointBySlug } from '@/lib/api-docs/registry';

export default function Page(): ReactElement {
  const doc = findEndpointBySlug('api/v1-status');
  if (!doc) throw new Error('endpoint doc missing');
  return <EndpointPage doc={doc} />;
}
