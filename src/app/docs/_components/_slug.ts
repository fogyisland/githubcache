/** Convert a registry slug (e.g. 'api/query') to a dotted namespace key (e.g. 'api-query'). */
export function slugToNs(slug: string): string {
  return slug.replace(/\//g, '-');
}
