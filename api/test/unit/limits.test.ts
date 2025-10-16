import { mergeLimits, DEFAULT_LIMITS } from '../../src/core/limits.js';

describe('mergeLimits', () => {
  it('merges defaults', () => {
    expect(mergeLimits(undefined)).toEqual(DEFAULT_LIMITS);
  });

  it('caps values', () => {
    expect(() => mergeLimits({ timeout_ms: 20001 })).toThrow('timeout_ms exceeds maximum');
  });
});
