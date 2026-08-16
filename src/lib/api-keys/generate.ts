import { randomBytes, createHash } from 'crypto';

const KEY_PREFIX = 'ghc_live_';

export interface GeneratedApiKey {
  plain: string;
  prefix: string;
  hash: string;
}

export function generateApiKey(): GeneratedApiKey {
  const hex = randomBytes(16).toString('hex');
  const plain = `${KEY_PREFIX}${hex}`;
  const prefix = plain.slice(0, 12);
  const hash = createHash('sha256').update(plain).digest('hex');
  return { plain, prefix, hash };
}