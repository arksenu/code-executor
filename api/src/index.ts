import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import Boom from '@hapi/boom';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger } from './util/logger.js';
import { ArtifactStorage } from './core/storage.js';
import { Authenticator } from './core/auth.js';
import { TokenBucketLimiter } from './core/rate_limit.js';
import { RunStore } from './core/run_store.js';
import { Orchestrator } from './core/orchestrator.js';
import { DockerSandbox } from './core/sandbox.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerFileRoutes } from './routes/files.js';
import { registerRunRoutes } from './routes/runs.js';

const logger = new Logger({ service: 'code-interpreter-api' });

function parseApiKeys(): Record<string, { label: string; rateLimitRps: number; burst: number }> {
  const tokensEnv = process.env.API_KEYS ?? 'dev_123:default:5:10';
  const entries = tokensEnv.split(',').filter(Boolean);
  const result: Record<string, { label: string; rateLimitRps: number; burst: number }> = {};
  for (const entry of entries) {
    const [token, label = 'default', rps = '5', burst = '10'] = entry.split(':');
    result[token] = { label, rateLimitRps: Number(rps), burst: Number(burst) };
  }
  return result;
}

const apiKeys = parseApiKeys();
const authenticator = new Authenticator({ tokens: apiKeys });
const limiter = new TokenBucketLimiter(5, 10);
const runStore = new RunStore();
const storage = new ArtifactStorage({
  baseDir: process.env.STORAGE_DIR ?? path.join(process.cwd(), 'data'),
  baseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:8080',
  signingKey: process.env.SIGNING_KEY ?? 'changeme-signing-key',
  urlTtlSeconds: 600
});

const sandbox = new DockerSandbox(
  {
    workRoot: process.env.SANDBOX_WORKDIR ?? '/sandbox',
    seccompProfile: process.env.SECCOMP_PROFILE ?? '/seccomp/default.json',
    appArmorProfile: process.env.APPARMOR_PROFILE
  },
  logger.child({ component: 'sandbox' })
);

const orchestrator = new Orchestrator({
  workRoot: process.env.SANDBOX_WORKDIR ?? '/sandbox',
  artifactStorage: storage,
  sandboxRunner: sandbox,
  logger: logger.child({ component: 'orchestrator' })
});

const app = express();
// Serve admin UI without Helmet so inline scripts work
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Determine admin UI directory with multiple fallback strategies
let adminDir: string;
if (process.env.ADMIN_UI_PATH) {
  // Use explicit environment variable if set
  adminDir = process.env.ADMIN_UI_PATH;
} else {
  // Try to intelligently find the admin UI directory
  // Check if we're in a Docker container (where workdir is /app)
  if (__dirname.startsWith('/app/')) {
    // In Docker: /app/dist → /app/web/admin
    adminDir = path.join('/app', 'web', 'admin');
  } else {
    // In local development or other environments
    // From api/src/ or api/dist/ → go up 2 levels to project root
    const projectRoot = path.join(__dirname, '..', '..');
    adminDir = path.join(projectRoot, 'web', 'admin');
  }
}

logger.info('Serving admin UI', { adminDir });
app.use(express.static(adminDir));
// Explicit index fallback (handles cases where static middleware is bypassed)
app.get('/', (_req, res) => {
  res.sendFile(path.join(adminDir, 'index.html'));
});
app.use(helmet());
app.use(compression());
app.use(bodyParser.json({ limit: '1mb' }));

registerHealthRoutes(app);
// Apply auth only to API routes, not to static assets
app.use('/v1', authenticator.middleware());
registerFileRoutes(app, { storage });
registerRunRoutes(app, { orchestrator, runStore, limiter, tokenLimits: apiKeys });

app.use((err: Boom.Boom | Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (!Boom.isBoom(err)) {
    logger.error('unhandled error', { message: err.message });
    res.status(500).json({ error: 'internal_error' });
    return;
  }
  const boom = err as Boom.Boom;
  res.status(boom.output.statusCode).json({ error: boom.message, data: boom.data });
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  logger.info('api listening', { port: port.toString() });
});

export default app;
