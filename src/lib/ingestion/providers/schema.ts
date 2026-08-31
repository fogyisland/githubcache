import { z } from 'zod';

/**
 * Provider configuration schemas for M19 ingestion sources.
 *
 * The DB stores `config_json` as a JSON column. To prevent schema drift we
 * validate the raw value against this Zod schema at every API boundary
 * (create / update / preview / run). M19 only supports the 'json' source
 * type; the discriminated union is shaped so we can extend with 'csv',
 * 'rss', etc. without breaking existing rows.
 *
 * Fields:
 *   kind       — 'file' reads from local disk; 'http' fetches a URL.
 *   itemsPath  — JSONPath expression that selects the array of items
 *                from the document root (e.g. '$.custom_nodes').
 *   urlField   — JSONPath expression evaluated on each item to extract
 *                the GitHub URL (e.g. 'files[0]', 'reference',
 *                'urls[*]').
 *   headers    — optional HTTP headers (http kind only).
 */
export const ProviderConfigSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('file'),
    path: z.string().min(1).max(1024),
    itemsPath: z.string().min(1).max(256),
    urlField: z.string().min(1).max(256),
  }),
  z.object({
    kind: z.literal('http'),
    url: z.string().url().max(2048),
    itemsPath: z.string().min(1).max(256),
    urlField: z.string().min(1).max(256),
    headers: z.record(z.string().max(128), z.string().max(512)).optional(),
  }),
]);

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

/**
 * Strict parse — throws ZodError on invalid input. Use at API boundaries.
 */
export function parseProviderConfig(input: unknown): ProviderConfig {
  return ProviderConfigSchema.parse(input);
}

/**
 * Loose check — returns true if input satisfies the schema shape. Use
 * when you only need to gate on validity (e.g. UI preview button).
 */
export function isProviderConfig(input: unknown): input is ProviderConfig {
  return ProviderConfigSchema.safeParse(input).success;
}