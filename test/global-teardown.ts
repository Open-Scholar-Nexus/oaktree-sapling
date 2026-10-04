/**
 * Removes the temporary directories the tests create [R152]. The tests call `mkdtempSync` in
 * many places without cleaning up, and a full /tmp fails unrelated tests; one teardown covers
 * every call, including new ones. Only directories changed since the run started are removed,
 * so another run's survive.
 */
import { readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PREFIXES = ['oak-', 'oaktree-'];
let startedAt = 0;

export function setup(): void {
  startedAt = Date.now();
}

export function teardown(): void {
  const dir = tmpdir();
  for (const name of readdirSync(dir)) {
    if (!PREFIXES.some((p) => name.startsWith(p))) continue;
    const abs = join(dir, name);
    try {
      if (statSync(abs).mtimeMs >= startedAt) rmSync(abs, { recursive: true, force: true });
    } catch {
      /* raced with another process, or not ours to remove */
    }
  }
}
