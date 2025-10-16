import type { Router } from 'express';

export function registerHealthRoutes(router: Router) {
  router.get('/v1/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
}
