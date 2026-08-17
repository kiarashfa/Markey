#!/usr/bin/env node
/**
 * `npm run check:site` — post-build assertions against `dist/`.
 *
 * PHASE 0 PLACEHOLDER. Planned assertions, each tied to a spec rule:
 *   - every emitted page lives under the `base` path (SPEC.md §6)
 *   - `/garage/` carries `noindex` AND is absent from the sitemap, while
 *     remaining crawlable in robots.txt (SPEC.md §12 — the "fetched but not
 *     indexed" trap)
 *   - Three.js / the wind-tunnel solver appear in NO bundle other than the
 *     Test Drive 3D chunk (SPEC.md §9.5.1, §13)
 *   - the Pagefind index exists and is non-empty
 *
 * Grows as the phases that make each assertion meaningful land (Phase 6, 8).
 * Exiting 0 here means "nothing asserted yet".
 */
console.log('[check:site] STUB — post-build assertions land alongside Phases 6 and 8.');
