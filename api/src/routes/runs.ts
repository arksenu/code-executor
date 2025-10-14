import Boom from '@hapi/boom';
import type { Router } from 'express';
import type { Orchestrator } from '../core/orchestrator.js';
import type { RunStore } from '../core/run_store.js';
import type { TokenBucketLimiter } from '../core/rate_limit.js';
import type { RunRequest } from '../core/types.js';

export interface RunRouteDeps {
  orchestrator: Orchestrator;
  runStore: RunStore;
  limiter: TokenBucketLimiter;
  tokenLimits: Record<string, { rateLimitRps: number; burst: number; label?: string }>;
}

export function registerRunRoutes(router: Router, deps: RunRouteDeps) {
  router.post('/v1/runs', async (req, res, next) => {
    try {
      const apiKey = (req as typeof req & { apiKey?: string }).apiKey;
      if (!apiKey) {
        throw Boom.unauthorized('missing api key');
      }
      const tokenConfig = deps.tokenLimits[apiKey];
      deps.limiter.check(apiKey, tokenConfig?.rateLimitRps, tokenConfig?.burst);
      const run = await deps.orchestrator.createRun(req.body as RunRequest, apiKey);
      deps.runStore.save(run);
      res.json(run);
    } catch (err) {
      next(err);
    }
  });

  router.get('/v1/runs/:id', (req, res, next) => {
    try {
      const run = deps.runStore.get(req.params.id);
      if (!run) {
        throw Boom.notFound('run not found');
      }
      res.json(run);
    } catch (err) {
      next(err);
    }
  });
}
