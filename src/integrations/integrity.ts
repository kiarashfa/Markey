/**
 * Build-time content integrity:
 * "The build fails loudly and completely."
 *
 * Hooks `astro:build:start` so broken content can never reach `dist/`, and
 * reports the **complete** list of violations rather than the first one, so
 * fixing content is one pass instead of a build-fix-build loop.
 *
 * The checks themselves live in `integrity-checks.ts`, framework-free, so the
 * standalone `check:content` / `check:self` scripts run exactly the same code
 * this integration does.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AstroIntegration } from 'astro';

import { formatViolations, runIntegrityChecks } from './integrity-checks.ts';

export default function integrity(): AstroIntegration {
  let projectRoot = process.cwd();
  let srcDir = path.join(projectRoot, 'src');

  return {
    name: 'markey:integrity',
    hooks: {
      'astro:config:done': ({ config }) => {
        projectRoot = fileURLToPath(config.root);
        srcDir = fileURLToPath(config.srcDir);
      },
      'astro:build:start': async ({ logger }) => {
        const violations = await runIntegrityChecks({
          contentRoot: path.join(srcDir, 'content'),
          bibliographyPath: path.join(srcDir, 'data', 'references.json'),
          displayRoot: projectRoot,
        });

        if (violations.length > 0) {
          logger.error(`\n${formatViolations(violations)}`);
          throw new Error(
            `Content integrity: ${violations.length} violation(s). The build is stopped so nothing broken reaches dist/. See the list above.`,
          );
        }
        logger.info('content integrity: all checks passed');
      },
    },
  };
}
