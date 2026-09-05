// M23 — timezone cookie constants. Mirrors src/lib/lang/constants.ts.

/** Cookie name carrying the user's selected IANA timezone (e.g. `Asia/Shanghai`). */
export const TIMEZONE_COOKIE_NAME = 'ghc_tz';

/** 1 year — matches the lang cookie so the choice survives long absences. */
export const TIMEZONE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
