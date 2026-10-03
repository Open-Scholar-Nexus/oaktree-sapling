import { describe, it, expect } from 'vitest';
import { classifyRef, decideRef } from '../src/ref.js';

describe('classifyRef', () => {
  it('classifies each ref shape', () => {
    expect(classifyRef('v0.3.0')).toBe('tag');
    expect(classifyRef('a'.repeat(40))).toBe('sha');
    expect(classifyRef('refs/pull/42/merge')).toBe('pr-merge');
    expect(classifyRef('main')).toBe('branch');
  });
});

describe('decideRef ([R196] / [R41], repo + ref-class trust)', () => {
  it('accepts a tag but flags it for the CI ancestry check', () => {
    const d = decideRef('v0.3.0', { isFork: true });
    expect(d.allowed).toBe(true);
    expect(d.needsAncestryCheck).toBe(true);
  });

  it('refuses a raw SHA from a fork pull request, which could run any code as oak', () => {
    expect(decideRef('a'.repeat(40), { isFork: true }).allowed).toBe(false);
  });

  it('allows a raw SHA on a same-repo pull request, for testing oak', () => {
    expect(decideRef('a'.repeat(40), { isFork: false }).allowed).toBe(true);
  });

  it('refuses a pull request merge ref from a fork, unless allowed', () => {
    expect(decideRef('refs/pull/9/merge', { isFork: true }).allowed).toBe(false);
    expect(decideRef('refs/pull/9/merge', { isFork: true, allowlisted: true }).allowed).toBe(true);
  });
});
