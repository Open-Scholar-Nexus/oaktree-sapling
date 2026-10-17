/**
 * For the tests that run the bundle (`dist/cli.cjs`) [R51]:
 *
 *   - **absent**: skip. `dist/cli.cjs` is gitignored, so a fresh clone has none, and `npm test`
 *     should run anywhere.
 *   - **stale**: fail. A bundle older than the newest file in `src/` runs old code [R71].
 *
 * `npm test` bundles first; this covers runs that do not (`npm run test:watch`, `vitest`, an
 * editor).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const engineDir = fileURLToPath(new URL('..', import.meta.url));
export const bundlePath = join(engineDir, 'dist', 'cli.cjs');
export const typstTemplate = join(engineDir, 'templates', 'typst');

/** The newest modification time under src/. */
function newestSourceMtime(): number {
  const srcDir = join(engineDir, 'src');
  if (!existsSync(srcDir)) return 0;
  return readdirSync(srcDir, { recursive: true })
    .map(String)
    .map((f) => join(srcDir, f))
    .filter((f) => f.endsWith('.ts') && existsSync(f))
    .reduce((max, f) => Math.max(max, statSync(f).mtimeMs), 0);
}

export type BundleState = 'absent' | 'stale' | 'fresh';

export function bundleState(): BundleState {
  if (!existsSync(bundlePath)) return 'absent';
  return statSync(bundlePath).mtimeMs < newestSourceMtime() ? 'stale' : 'fresh';
}

/** Throws when the bundle is stale. Call it from `beforeAll` in tests that run the bundle. */
export function assertBundleNotStale(): void {
  if (bundleState() === 'stale') {
    throw new Error(
      `dist/cli.cjs is OLDER than src/; this suite would exercise stale code and pass.\n` +
        `Run \`npm run bundle\` (\`npm test\` does it for you; \`test:watch\` does not).`,
    );
  }
}

function typstPresent(): boolean {
  try {
    execFileSync('typst', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Whether a test can render a PDF through the bundle: the bundle, oak's template and typst are
 *  all present. A stale bundle counts, so {@link assertBundleNotStale} fails the test. */
export function canRenderPdf(): boolean {
  return bundleState() !== 'absent' && existsSync(typstTemplate) && typstPresent();
}
