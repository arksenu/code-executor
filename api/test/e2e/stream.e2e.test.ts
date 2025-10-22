import express from 'express';
import http from 'node:http';
import WebSocket from 'ws';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import bodyParser from 'body-parser';
import { registerStreamRoutes } from '../../src/routes/stream.js';
import { ArtifactStorage } from '../../src/core/storage.js';
import { Authenticator } from '../../src/core/auth.js';
import { TokenBucketLimiter } from '../../src/core/rate_limit.js';
import { RunStore } from '../../src/core/run_store.js';
import { Orchestrator } from '../../src/core/orchestrator.js';
import { Logger } from '../../src/util/logger.js';
import type { SandboxRunner, SandboxRunSpec, SandboxResult } from '../../src/core/types.js';

class MockStreamingSandbox implements SandboxRunner {
  async run(spec: SandboxRunSpec): Promise<SandboxResult> {
    // Simulate streaming output
    if (spec.streamCallback) {
      // Simulate progressive output
      setTimeout(() => {
        spec.streamCallback!({
          type: 'stdout',
          data: 'Processing...\n',
          timestamp: Date.now()
        });
      }, 10);

      setTimeout(() => {
        spec.streamCallback!({
          type: 'stdout',
          data: 'Step 1 complete\n',
          timestamp: Date.now()
        });
      }, 20);

      setTimeout(() => {
        spec.streamCallback!({
          type: 'stdout',
          data: 'Step 2 complete\n',
          timestamp: Date.now()
        });
      }, 30);

      // Wait for callbacks to complete
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    const outputDir = path.join(spec.workdir, 'outputs');
    fs.mkdirSync(outputDir, { recursive: true });

    return {
      status: 'succeeded',
      exitCode: 0,
      stdout: Buffer.from('Processing...\nStep 1 complete\nStep 2 complete\n'),
      stderr: Buffer.alloc(0),
      usage: { wall_ms: 50, cpu_ms: 40, max_rss_mb: 10 },
      artifacts: []
    };
  }
}

describe('WebSocket Streaming API', () => {
  const token = 'dev_123';
  let app: express.Express;
  let server: http.Server;
  let storage: ArtifactStorage;
  let port: number;

  beforeEach((done) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'code-int-stream-'));
    storage = new ArtifactStorage({
      baseDir: path.join(tmp, 'storage'),
      baseUrl: 'http://localhost:8080',
      signingKey: 'signing',
      urlTtlSeconds: 600
    });
    const orchestrator = new Orchestrator({
      workRoot: path.join(tmp, 'sandbox'),
      artifactStorage: storage,
      sandboxRunner: new MockStreamingSandbox(),
      logger: new Logger({ test: 'stream-e2e' })
    });
    const limiter = new TokenBucketLimiter(5, 5);
    const runStore = new RunStore();
    const authenticator = new Authenticator({ tokens: { [token]: { label: 'dev', rateLimitRps: 5, burst: 5 } } });

    app = express();
    app.use(bodyParser.json({ limit: '1mb' }));
    app.use(authenticator.middleware());

    // Create HTTP server
    server = http.createServer(app);

    // Register streaming routes
    registerStreamRoutes(app, server, {
      orchestrator,
      runStore,
      limiter,
      tokenLimits: { [token]: { label: 'dev', rateLimitRps: 5, burst: 5 } },
      logger: new Logger({ test: 'stream-e2e' })
    });

    app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (err.isBoom) {
        res.status(err.output.statusCode).json({ error: err.message });
      } else {
        res.status(500).json({ error: err.message });
      }
    });

    // Start server on random port
    server.listen(0, () => {
      const addr = server.address();
      port = typeof addr === 'object' && addr ? addr.port : 8080;
      done();
    });
  });

  afterEach((done) => {
    if (server) {
      server.close(done);
    } else {
      done();
    }
  });

  it('should stream code execution output via WebSocket', (done) => {
    const messages: any[] = [];

    // First, create a streaming run
    fetch(`http://localhost:${port}/v1/runs/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        language: 'python',
        code: 'print("Hello, World!")'
      })
    })
      .then(res => res.json())
      .then(data => {
        expect(data.id).toBeDefined();
        expect(data.status).toBe('starting');

        const runId = data.id;

        // Connect to WebSocket
        const ws = new WebSocket(`ws://localhost:${port}/v1/runs/${runId}/stream`);

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          messages.push(message);

          // Check if this is the completion message
          if (message.type === 'complete') {
            expect(messages.length).toBeGreaterThan(1);

            // Verify we received connection confirmation
            const connectedMsg = messages.find(m => m.type === 'connected');
            expect(connectedMsg).toBeDefined();
            expect(connectedMsg.runId).toBe(runId);

            // Verify we received status updates
            const statusMsg = messages.find(m => m.type === 'status');
            expect(statusMsg).toBeDefined();

            // Verify we received stdout
            const stdoutMsgs = messages.filter(m => m.type === 'stdout');
            expect(stdoutMsgs.length).toBeGreaterThan(0);

            // Verify completion message contains run record
            expect(message.runRecord).toBeDefined();
            expect(message.runRecord.status).toBe('succeeded');
            expect(message.runRecord.stdout).toContain('Processing');

            ws.close();
            done();
          }
        });

        ws.on('error', (error) => {
          done(error);
        });
      })
      .catch(err => {
        done(err);
      });
  }, 10000); // 10 second timeout

  it('should handle WebSocket connection before run starts', (done) => {
    // This test simulates connecting to a WebSocket endpoint
    // that will receive a run created shortly after
    const runId = `run_test123`;

    const ws = new WebSocket(`ws://localhost:${port}/v1/runs/${runId}/stream`);

    ws.on('open', () => {
      // Connection established
      expect(ws.readyState).toBe(WebSocket.OPEN);
    });

    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());

      if (message.type === 'connected') {
        expect(message.runId).toBe(runId);
        ws.close();
        done();
      }
    });

    ws.on('error', (error) => {
      done(error);
    });
  });

  it('should require authentication for streaming endpoint', (done) => {
    fetch(`http://localhost:${port}/v1/runs/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        language: 'python',
        code: 'print("test")'
      })
    })
      .then(res => {
        expect(res.status).toBe(401);
        done();
      })
      .catch(err => {
        done(err);
      });
  });
});
