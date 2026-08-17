#!/usr/bin/env node
/**
 * `npm run check:self` — proves the integrity checks themselves still bite.
 *
 * SPEC.md §13: CI runs the checks against a known-bad fixture set "which must
 * still fail (proves the checks haven't silently stopped catching problems)".
 *
 * Read the exit code carefully, because the two senses of "fail" are easy to
 * confuse:
 *
 *   exit 0  →  the checks correctly REJECTED the broken fixtures. Good.
 *   exit 1  →  a fixture the checks are supposed to catch slipped through,
 *              i.e. a check has rotted. This is the alarm.
 *
 * (Instruction.md's Phase 1 DoD phrases this as "check:self fails against the
 * broken fixtures". That describes the *checks* failing the fixtures — which
 * is what this script asserts. If the script itself exited non-zero on a
 * correct run, it could never serve as a CI gate, because CI would be
 * permanently red.)
 *
 * `expected-violations.json` in the fixture directory lists the (file, rule)
 * pairs that must be reported. Extra violations beyond that list are printed
 * as a note, not an error — adding a new check shouldn't break this gate.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runIntegrityChecks } from '../../src/integrations/integrity-checks.ts';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const fixtureRoot = path.join(root, 'test-fixtures', 'broken-content');
const manifestPath = path.join(fixtureRoot, 'expected-violations.json');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

const violations = await runIntegrityChecks({
  contentRoot: path.join(fixtureRoot, 'content'),
  bibliographyPath: path.join(fixtureRoot, 'references.json'),
  displayRoot: root,
});

const reported = new Set(violations.map((v) => `${normalise(v.file)}::${v.rule}`));

const missing = [];
for (const expectation of manifest.expected) {
  for (const rule of expectation.rules) {
    const token = `${normalise(expectation.file)}::${rule}`;
    if (!reported.has(token)) {
      missing.push({ file: expectation.file, rule, why: expectation.why });
    }
  }
}

const expectedTokens = new Set(
  manifest.expected.flatMap((e) => e.rules.map((r) => `${normalise(e.file)}::${r}`)),
);
const extra = [...reported].filter((t) => !expectedTokens.has(t));

console.log(
  `[check:self] ran ${manifest.expected.length} fixture file(s); the checks reported ${violations.length} violation(s).`,
);

if (violations.length === 0) {
  console.error(
    '\ncheck:self FAILED — the broken fixtures produced NO violations at all.\n' +
      'The integrity checks have stopped working entirely.',
  );
  process.exit(1);
}

if (missing.length > 0) {
  console.error(`\ncheck:self FAILED — ${missing.length} expected violation(s) were NOT caught:\n`);
  for (const m of missing) {
    console.error(`  ${m.file}`);
    console.error(`    missing rule: ${m.rule}`);
    console.error(`    fixture exists to prove: ${m.why}`);
  }
  console.error(
    '\nA check that no longer catches its own fixture is a check that will not catch real content either.',
  );
  process.exit(1);
}

if (extra.length > 0) {
  console.log(`[check:self] note — ${extra.length} additional violation(s) beyond the manifest:`);
  for (const token of extra) console.log(`    ${token.replace('::', '  →  ')}`);
  console.log('  (not a failure; add them to expected-violations.json once deliberate.)');
}

console.log('[check:self] passed — every known-bad fixture was correctly rejected.');

function normalise(file) {
  return file.split(path.sep).join('/');
}
