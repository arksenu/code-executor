import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import cors from 'cors';
import bodyParser from 'body-parser';
import Boom from '@hapi/boom';
import path from 'node:path';
import fs from 'node:fs';
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

const logger = new Logger({ service: 'code-executor-api' });

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

// Enable CORS for all origins (customize for production)
// This is required for Open-WebUI integration as it needs to access the API from the browser
// Applied before static serving to ensure all resources get CORS headers
app.use(cors({
  origin: true, // Allow all origins in development
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(compression());
app.use(bodyParser.json({ limit: '1mb' }));

// Static file serving and routes WITHOUT Helmet (to allow inline scripts in admin UI)
app.use(express.static(adminDir));
// Explicit index fallback (handles cases where static middleware is bypassed)
app.get('/', (_req, res) => {
  res.sendFile(path.join(adminDir, 'index.html'));
});

// Serve OpenAPI spec (no auth required for spec discovery)
// This endpoint is used by Open-WebUI to discover available API endpoints and their schemas
// Since we don't have a YAML parser installed, we return a pre-converted JSON version
app.get('/openapi.json', (_req, res) => {
  // Hardcoded OpenAPI spec in JSON format (converted from spec.yaml)
  // Update the server URL to match the actual deployment
  const baseUrl = process.env.PUBLIC_BASE_URL ?? 'http://localhost:8080';

  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'Code Executor API',
      version: '0.1.0',
      description: 'Execute code in sandboxed environments'
    },
    servers: [
      { url: baseUrl }
    ],
    paths: {
      '/v1/health': {
        get: {
          operationId: 'health_check',
          summary: 'Liveness and readiness probe',
          tags: ['System'],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: {
                        type: 'string',
                        example: 'ok'
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/v1/runs': {
        post: {
          operationId: 'execute_code',
          summary: 'Execute code in a sandbox',
          description: 'Run code in an isolated environment with resource limits',
          tags: ['Code Execution'],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['language', 'code'],
                  properties: {
                    language: {
                      type: 'string',
                      enum: ['python', 'node', 'ruby', 'php'],
                      description: 'Programming language to execute'
                    },
                    code: {
                      type: 'string',
                      maxLength: 204800,
                      description: 'Code to execute'
                    }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Run completed successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      id: {
                        type: 'string',
                        description: 'Unique run identifier'
                      },
                      status: {
                        type: 'string',
                        enum: ['succeeded', 'failed', 'timeout', 'oom', 'killed'],
                        description: 'Execution status'
                      },
                      stdout: {
                        type: 'string',
                        description: 'Standard output from the code'
                      },
                      stderr: {
                        type: 'string',
                        description: 'Standard error output'
                      },
                      exit_code: {
                        type: 'integer',
                        nullable: true,
                        description: 'Process exit code'
                      }
                    }
                  }
                }
              }
            },
            '400': {
              description: 'Bad Request'
            },
            '401': {
              description: 'Unauthorized'
            },
            '429': {
              description: 'Rate Limited'
            }
          }
        }
      }
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'token',
          description: 'Bearer token authentication'
        }
      }
    },
    tags: [
      {
        name: 'Code Execution',
        description: 'Execute code in sandboxed environments'
      },
      {
        name: 'System',
        description: 'System health and status'
      }
    ]
  };

  res.json(spec);
});

// Add dummy /models endpoints for compatibility with OpenAI clients
// Open-WebUI sometimes checks these endpoints when detecting API type
// We return an empty list since we're not a language model provider
app.get('/models', (_req, res) => {
  res.json({
    object: "list",
    data: []  // Empty models list - we're not a language model
  });
});

app.get('/v1/models', (_req, res) => {
  res.json({
    object: "list",
    data: []  // Empty models list - we're not a language model
  });
});

registerHealthRoutes(app);
// Apply Helmet and auth only to API routes, not to static assets
app.use('/v1', helmet());  // Security headers for API routes only
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
