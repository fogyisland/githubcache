# Berkeley Mono License Verification

**Date:** 2026-09-14
**Sources consulted:**
- `https://berkeleygraphics.com/typefaces/berkeley-mono/` (vendor site) — NOT VERIFIED (sandbox blocked)
- `https://github.com/berkeleyfont/berkeley-mono` (community repo) — NOT VERIFIED (sandbox blocked)

## Verdict

LICENSE_UNKNOWN

## Fallback

fallback to IBM Plex Mono (SIL OFL 1.1)

## Reasoning

Network access is restricted in the sandbox environment used for M32 task 1 implementation. Both the Berkeley Graphics vendor site and the community GitHub repository are unreachable for license verification. Without external confirmation, the license status of Berkeley Mono for commercial web use cannot be determined. Per the M32 binding fallback rule, we default to IBM Plex Mono (SIL OFL 1.1) as the primary font in the CSS stack. Berkeley Mono is listed first in the font-family declaration as an aspirational preferred font; if/when a license review can happen in a connected environment and Berkeley Mono is confirmed as freely usable, the stack will already resolve to it correctly. IBM Plex Mono is the safe default until that verification happens.
