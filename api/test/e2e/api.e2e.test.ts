import express from 'express';
import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import bodyParser from 'body-parser';
import { registerHealthRoutes } from '../../src/routes/health.js';
import { registerFileRoutes } from '../../src/routes/files.js';
import { registerRunRoutes } from '../../src/routes/runs.js';
import { ArtifactStorage } from '../../src/core/storage.js';
import { Authenticator } from '../../src/core/auth.js';
import { TokenBucketLimiter } from '../../src/core/rate_limit.js';
import { RunStore } from '../../src/core/run_store.js';
import { Orchestrator } from '../../src/core/orchestrator.js';
import { Logger } from '../../src/util/logger.js';
import type { SandboxRunner, SandboxRunSpec, SandboxResult } from '../../src/core/types.js';

class MockSandbox implements SandboxRunner {
  async run(spec: SandboxRunSpec): Promise<SandboxResult> {
    if (spec.code.includes('while True')) {
      return {
        status: 'timeout',
        exitCode: null,
        stdout: Buffer.from(''),
        stderr: Buffer.from('timeout'),
        usage: { wall_ms: spec.limits.timeout_ms, cpu_ms: spec.limits.cpu_ms, max_rss_mb: spec.limits.memory_mb },
        artifacts: []
      };
    }
    if (spec.code.includes('memory_bomb')) {
      return {
        status: 'oom',
        exitCode: 137,
        stdout: Buffer.from(''),
        stderr: Buffer.from('oom'),
        usage: { wall_ms: spec.limits.timeout_ms, cpu_ms: spec.limits.cpu_ms, max_rss_mb: spec.limits.memory_mb },
        artifacts: []
      };
    }
    if (spec.code.includes('forbidden_syscall')) {
      return {
        status: 'failed',
        exitCode: 1,
        stdout: Buffer.from(''),
        stderr: Buffer.from('seccomp violation'),
        usage: { wall_ms: 1, cpu_ms: 1, max_rss_mb: 1 },
        artifacts: []
      };
    }
    const outputDir = path.join(spec.workdir, 'outputs');
    fs.mkdirSync(outputDir, { recursive: true });
    const artifactPath = path.join(outputDir, 'report.txt');
    fs.writeFileSync(artifactPath, 'ok');
    return {
      status: 'succeeded',
      exitCode: 0,
      stdout: Buffer.from('hello'),
      stderr: Buffer.alloc(0),
      usage: { wall_ms: 5, cpu_ms: 5, max_rss_mb: 10 },
      artifacts: [{ path: artifactPath, name: 'report.txt', size: 2, contentType: 'text/plain' }]
    };
  }
}

describe('Code Interpreter API', () => {
  const token = 'dev_123';
  let app: express.Express;
  let storage: ArtifactStorage;

  beforeEach(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'code-int-'));
    storage = new ArtifactStorage({
      baseDir: path.join(tmp, 'storage'),
      baseUrl: 'http://localhost:8080',
      signingKey: 'signing',
      urlTtlSeconds: 600
    });
    const orchestrator = new Orchestrator({
      workRoot: path.join(tmp, 'sandbox'),
      artifactStorage: storage,
      sandboxRunner: new MockSandbox(),
      logger: new Logger({ test: 'e2e' })
    });
    const limiter = new TokenBucketLimiter(5, 5);
    const runStore = new RunStore();
    const authenticator = new Authenticator({ tokens: { [token]: { label: 'dev', rateLimitRps: 5, burst: 5 } } });
    app = express();
    app.use(bodyParser.json({ limit: '1mb' }));
    registerHealthRoutes(app);
    app.use(authenticator.middleware());
    registerFileRoutes(app, { storage });
    registerRunRoutes(app, { orchestrator, runStore, limiter, tokenLimits: { [token]: { label: 'dev', rateLimitRps: 5, burst: 5 } } });
    app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (err.isBoom) {
        res.status(err.output.statusCode).json({ error: err.message });
      } else {
        res.status(500).json({ error: err.message });
      }
    });
  });

  it('returns health', async () => {
    const res = await request(app).get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('creates successful run', async () => {
    const res = await request(app)
      .post('/v1/runs')
      .set('Authorization', `Bearer ${token}`)
      .send({ language: 'python', code: 'print("hi")' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('succeeded');
  });

  it('handles timeout run', async () => {
    const res = await request(app)
      .post('/v1/runs')
      .set('Authorization', `Bearer ${token}`)
      .send({ language: 'python', code: 'while True: pass' });
    expect(res.body.status).toBe('timeout');
  });

  it('handles oom run', async () => {
    const res = await request(app)
      .post('/v1/runs')
      .set('Authorization', `Bearer ${token}`)
      .send({ language: 'python', code: 'memory_bomb()' });
    expect(res.body.status).toBe('oom');
  });

  it('returns artifact URL', async () => {
    const res = await request(app)
      .post('/v1/runs')
      .set('Authorization', `Bearer ${token}`)
      .send({ language: 'python', code: 'print("artifact")' });
    expect(res.body.artifacts).toHaveLength(1);
    const artifactUrl: string = res.body.artifacts[0].url;
    const url = new URL(artifactUrl);
    const artifactId = url.pathname.split('/').pop();
    const download = await request(app)
      .get(`/v1/files/${artifactId}${url.search}`)
      .set('Authorization', `Bearer ${token}`);
    expect(download.status).toBe(200);
  });

  it('stages uploaded files into run', async () => {
    const upload = await request(app)
      .post('/v1/files')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('hello'), 'input.txt');
    expect(upload.status).toBe(200);
    const fileId = upload.body.id;
    const run = await request(app)
      .post('/v1/runs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        language: 'python',
        code: 'print("file")',
        files: [{ id: fileId, path: 'dataset/input.txt' }]
      });
    expect(run.status).toBe(200);
    expect(run.body.status).toBe('succeeded');
  });

  it('enforces rate limit', async () => {
    const agent = request(app);
    for (let i = 0; i < 5; i++) {
      await agent.post('/v1/runs').set('Authorization', `Bearer ${token}`).send({ language: 'python', code: 'print(1)' });
    }
    const res = await agent
      .post('/v1/runs')
      .set('Authorization', `Bearer ${token}`)
      .send({ language: 'python', code: 'print(1)' });
    expect(res.status).toBe(429);
  });
});
