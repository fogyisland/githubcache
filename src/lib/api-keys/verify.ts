import { createHash, timingSafeEqual } from 'crypto';

export async function verifyApiKey(plain: string, hash: string): Promise<boolean> {
  const computed = createHash('sha256').update(plain).digest('hex');
  // Constant-time comparison via timingSafeEqual to defeat timing attacks
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}