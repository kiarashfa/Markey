#!/usr/bin/env node
/**
 * `npm run check:content` — the content-integrity gate.
 *
 * PHASE 0 PLACEHOLDER. The real checks (SPEC.md §13, Instruction.md Phase 1)
 * live in `src/integrations/integrity.ts` and enforce:
 *   - narrative .mdx ↔ data .json pairing, 1:1
 *   - every `id` matching its filename
 *   - every `parent` resolving to a real entry of a valid `kind`
 *   - every citation key resolving into the bibliography
 *   - every image carrying a `licenseType`
 * ...reporting the COMPLETE list of violations, never just the first.
 *
 * It exists now, exiting 0, so the gated pipeline in package.json has its
 * final shape from day one. There is no content to check yet, so passing
 * here means "nothing to do", NOT "content verified".
 */
console.log('[check:content] STUB — no content collections exist yet. Real checks land in Phase 1.');
