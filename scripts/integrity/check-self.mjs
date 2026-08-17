#!/usr/bin/env node
/**
 * `npm run check:self` — proves the integrity checks themselves still work.
 *
 * PHASE 0 PLACEHOLDER. Per SPEC.md §13, CI runs the content checks against
 * `test-fixtures/broken-content/` — content that is deliberately invalid and
 * MUST still fail. If it ever passes, the checks have silently stopped
 * catching problems and this script exits non-zero.
 *
 * Wired up in Phase 1, at the same time as the checks it guards. Exiting 0
 * here means "no fixtures yet", NOT "the checks are known good".
 */
console.log('[check:self] STUB — no broken-content fixtures yet. Real self-test lands in Phase 1.');
