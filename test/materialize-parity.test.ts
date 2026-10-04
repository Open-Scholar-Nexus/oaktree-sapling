/**
 * `oak build`, `oak start` and `oak validate` compose from the same inputs, so they write the
 * same `myst.oak.yml` [R82]. `readStampedTemplate` (`zenodo.ts`) reads that file as the record
 * of which template rendered the PDF, so a validate after a build must not change it.
 *
 * `MaterializeInput.assetOverrides` is optional, so the type checker misses a call site that
 * leaves it out. This checks the source instead: every verb builds its input with the one
 * shared builder, so a field added for build reaches the others too.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cli = readFileSync(fileURLToPath(new URL('../src/cli.ts', import.meta.url)), 'utf8');

/** Call sites of `name(`, ignoring its own `function name(` declaration. */
function callsTo(src: string, name: string): number {
  return src.split('\n').filter((l) => l.includes(`${name}(`) && !l.includes(`function ${name}(`))
    .length;
}

describe('build and validate materialize from the same inputs', () => {
  it('assetOverridesFrom is reached only through the shared builder', () => {
    // 0 means the builder stopped passing overrides; more than 1 means a verb builds its own.
    expect(callsTo(cli, 'assetOverridesFrom')).toBe(1);
    const builder = cli.slice(cli.indexOf('function materializeInputFrom'));
    expect(builder.slice(0, builder.indexOf('\n}')).includes('assetOverridesFrom(argv)')).toBe(
      true,
    );
  });

  it('every verb that materializes spreads the shared builder', () => {
    // build, start and validate. They spread the builder's result, so a new MaterializeInput
    // field reaches all three.
    expect(callsTo(cli, 'materializeInputFrom')).toBe(3);
    expect(cli.match(/\.\.\.materializeInputFrom\(argv, paperRoot, /g)?.length).toBe(3);
  });

  it('validate does not rebuild the shared fields by hand', () => {
    // cmdValidate must not list paperRoot, engineRoot, engineRepo or assetOverrides itself,
    // since its own list could differ from the build's.
    const call = cli.slice(cli.indexOf('await runValidate('));
    // Leave out the builder call, where `paperRoot` and `instanceRoot` are its arguments.
    const body = call
      .slice(0, call.indexOf('\n      },'))
      .split('\n')
      .filter((l) => !l.includes('materializeInputFrom('))
      .join('\n');
    for (const field of [
      'engineRoot:',
      'engineRepo:',
      'assetOverrides:',
      'baseUrl:',
      'paperRoot,',
      'instanceRoot,',
    ]) {
      expect(
        body,
        `runValidate re-lists ${field} instead of taking it from the builder`,
      ).not.toContain(field);
    }
  });
});
