import bcrypt from 'bcrypt';

const BCRYPT_COST = 12;

/**
 * Hash a plaintext password using bcrypt with cost factor 12.
 *
 * Cost 12 = ~250ms per hash on modern hardware. Sufficient for offline
 * brute-force resistance per OWASP 2024 guidance. Tune via BCRYPT_COST
 * env var if needed (lower in CI, higher in production).
 *
 * Returns the full bcrypt hash string (algorithm + cost + salt + hash).
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

/**
 * Verify a plaintext password against a stored bcrypt hash.
 *
 * Uses bcrypt's constant-time comparison. Returns false for any error
 * (invalid hash format, wrong password, etc.) — never throws.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
