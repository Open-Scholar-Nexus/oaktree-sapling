/**
 * The version `oak bootstrap` pins: the running oak's own by default, refused for a build that is
 * not a stable release, and `--engine-version` taken as given when it is a release tag. The
 * newest-release lookup is a fake, so nothing here needs the network.
 */
import { describe, it, expect } from 'vitest';
import { isStableVersion, pinnedEngineVersion, newerRelease } from '../src/engine-version.js';
import { UserError } from '../src/messages.js';

describe('pinnedEngineVersion', () => {
  it('pins the running oak by default, as a tag', () => {
    expect(pinnedEngineVersion(undefined, '1.2.3')).toEqual({
      engineVersion: 'v1.2.3',
      resolved: { engineVersionFrom: 'running-oak', runningVersion: '1.2.3' },
    });
  });

  it('refuses a dev or unreleased build without --engine-version', () => {
    for (const running of ['1.2.3-dev.4', '1.2.3-unreleased+abc1234']) {
      expect(() => pinnedEngineVersion(undefined, running)).toThrow(UserError);
      expect(() => pinnedEngineVersion(undefined, running)).toThrow(
        new RegExp(
          `the running oak \\(${running.replace(/[.+]/g, '\\$&')}\\) is not a stable release.*--engine-version <tag>`,
        ),
      );
    }
  });

  it('takes --engine-version as given, on any build', () => {
    for (const running of ['1.2.3', '1.2.3-dev.4', '1.2.3-unreleased+abc1234']) {
      for (const tag of ['v1.2.3', 'v2.0.0', 'v1.3.0-dev.7']) {
        expect(pinnedEngineVersion(tag, running)).toEqual({
          engineVersion: tag,
          resolved: { engineVersionFrom: 'flag', runningVersion: running },
        });
      }
    }
  });

  it('refuses an --engine-version that is not a release tag', () => {
    for (const tag of [
      'main',
      '1.2.3',
      'v1.2',
      'v1.2.3-rc.1',
      'v1.2.3-dev',
      '--upload-pack=x',
      'v1.2.3 ',
    ]) {
      expect(() => pinnedEngineVersion(tag, '1.2.3')).toThrow(
        /--engine-version must be a release tag/,
      );
    }
  });
});

describe('isStableVersion', () => {
  it('is true only for X.Y.Z', () => {
    expect(isStableVersion('1.2.3')).toBe(true);
    for (const v of ['1.2.3-dev.4', '1.2.3-unreleased+abc1234', 'v1.2.3', '']) {
      expect(isStableVersion(v)).toBe(false);
    }
  });
});

describe('newerRelease', () => {
  const tag = (t: string) => async () => t;

  it('names the newest release when it is newer than the running oak', async () => {
    expect(await newerRelease('1.2.3', tag('v1.10.0'))).toBe('v1.10.0');
  });

  it('is undefined when the running oak is the newest or newer', async () => {
    expect(await newerRelease('1.2.3', tag('v1.2.3'))).toBeUndefined();
    expect(await newerRelease('1.2.3', tag('v1.2.2'))).toBeUndefined();
  });

  it('is undefined when the lookup fails or returns no release tag', async () => {
    const fail = async (): Promise<string> => {
      throw new Error('npm registry: 404');
    };
    expect(await newerRelease('1.2.3', fail)).toBeUndefined();
    expect(await newerRelease('1.2.3', tag('nightly'))).toBeUndefined();
  });
});
