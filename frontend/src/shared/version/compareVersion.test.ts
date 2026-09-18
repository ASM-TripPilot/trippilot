import fc from 'fast-check';

import { compareVersion } from './compareVersion';

const validVersionArb = fc
  .array(fc.nat({ max: 99 }), { minLength: 1, maxLength: 4 })
  .map((parts) => parts.join('.'));

const garbageVersionArb = fc.oneof(
  fc.constantFrom(
    '',
    ' ',
    'abc',
    'x.y.z',
    'not-a-version',
    'null',
    'undefined',
    'NaN',
    '..',
    'v',
    '1.two.3'
  ),
  fc
    .string({ minLength: 1, maxLength: 12 })
    .filter((s) => /[a-zA-Z]/.test(s) && !/^\d/.test(s))
);

describe('compareVersion (semver, force-update gate)', () => {
  it('returns only -1, 0, or 1 for any pair of valid versions', () => {
    fc.assert(
      fc.property(validVersionArb, validVersionArb, (a, b) => {
        expect([-1, 0, 1]).toContain(compareVersion(a, b));
      }),
      { numRuns: 500 }
    );
  });

  it('is antisymmetric: compare(a,b) is the negation of compare(b,a)', () => {
    fc.assert(
      fc.property(validVersionArb, validVersionArb, (a, b) => {
        expect(compareVersion(a, b) + compareVersion(b, a)).toBe(0);
      }),
      { numRuns: 500 }
    );
  });

  it('returns 0 when both operands are the same valid version', () => {
    fc.assert(
      fc.property(validVersionArb, (v) => {
        expect(compareVersion(v, v)).toBe(0);
      }),
      { numRuns: 500 }
    );
  });

  it('fails open: an unparseable version never reads as strictly-older (never -1), so the force-update gate cannot fire on garbage input', () => {
    fc.assert(
      fc.property(garbageVersionArb, validVersionArb, (bad, good) => {
        expect(() => compareVersion(bad, good)).not.toThrow();
        expect(compareVersion(bad, good)).not.toBe(-1);
        expect(compareVersion(good, bad)).not.toBe(-1);
      }),
      { numRuns: 500 }
    );

    fc.assert(
      fc.property(garbageVersionArb, garbageVersionArb, (a, b) => {
        expect(compareVersion(a, b)).not.toBe(-1);
      }),
      { numRuns: 500 }
    );
  });
});
