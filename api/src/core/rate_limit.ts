import Boom from '@hapi/boom';

interface BucketState {
  tokens: number;
  lastRefill: number;
}

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, BucketState>();

  constructor(private readonly defaultRps: number, private readonly defaultBurst: number) {}

  public check(key: string, rps?: number, burst?: number) {
    const now = Date.now();
    const state = this.buckets.get(key) ?? { tokens: burst ?? this.defaultBurst, lastRefill: now };
    const rate = rps ?? this.defaultRps;
    const capacity = burst ?? this.defaultBurst;
    const elapsed = (now - state.lastRefill) / 1000;
    const refill = elapsed * rate;
    const newTokens = Math.min(capacity, state.tokens + refill);
    if (newTokens < 1) {
      state.tokens = newTokens;
      state.lastRefill = now;
      this.buckets.set(key, state);
      throw Boom.tooManyRequests('rate limit exceeded');
    }
    state.tokens = newTokens - 1;
    state.lastRefill = now;
    this.buckets.set(key, state);
  }
}
