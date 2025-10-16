import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Orchestrator } from '../../src/core/orchestrator.js';
import { ArtifactStorage } from '../../src/core/storage.js';
import { Logger } from '../../src/util/logger.js';
import type { SandboxRunner, SandboxRunSpec, SandboxResult } from '../../src/core/types.js';

class MockSandbox implements SandboxRunner {
  constructor(private readonly resultFactory: (spec: SandboxRunSpec) => SandboxResult) {}
  async run(spec: SandboxRunSpec): Promise<SandboxResult> {
    return this.resultFactory(spec);
  }
}

describe('Orchestrator', () => {
  let tmpDir: string;
  let orchestrator: Orchestrator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-'));
    const storage = new ArtifactStorage({
      baseDir: path.join(tmpDir, 'storage'),
      baseUrl: 'http://localhost:8080',
      signingKey: 'test-key',
      urlTtlSeconds: 600
    });
    const sandbox = new MockSandbox((spec) => {
      const outPath = path.join(spec.workdir, 'outputs', 'result.txt');
      fs.writeFileSync(outPath, 'artifact');
      return {
        status: 'succeeded',
        exitCode: 0,
        stdout: Buffer.from('hello'),
        stderr: Buffer.alloc(0),
        usage: { wall_ms: 10, cpu_ms: 5, max_rss_mb: 2 },
        artifacts: [
          { path: outPath, name: 'result.txt', size: 8, contentType: 'text/plain' }
        ]
      };
    });
    orchestrator = new Orchestrator({
      workRoot: path.join(tmpDir, 'sandbox'),
      artifactStorage: storage,
      sandboxRunner: sandbox,
      logger: new Logger({ test: 'orchestrator' })
    });
  });

  it('creates runs and stores artifacts', async () => {
    const run = await orchestrator.createRun({ language: 'python', code: 'print("hi")' }, 'dev');
    expect(run.status).toBe('succeeded');
    expect(run.artifacts).toHaveLength(1);
    expect(run.artifacts[0].name).toBe('result.txt');
  });
});
