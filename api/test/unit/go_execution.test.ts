import { describe, it, expect, jest, beforeAll, afterAll } from '@jest/globals';
import { Orchestrator } from '../../src/core/orchestrator';
import { RunRequest } from '../../src/core/types';
import { DockerSandbox } from '../../src/core/sandbox';
import { ArtifactStorage } from '../../src/core/storage';
import { RunStore } from '../../src/core/run_store';
import { ApiKeyStore } from '../../src/core/auth';
import { RateLimiter } from '../../src/core/rate_limit';
import { Logger } from '../../src/util/logger';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('Go Language Support', () => {
  let orchestrator: Orchestrator;
  let tempDir: string;

  beforeAll(async () => {
    // Create a temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'go-test-'));

    const logger = new Logger();
    const sandbox = new DockerSandbox(
      {
        workRoot: tempDir,
        seccompProfile: '/seccomp/default.json',
        appArmorProfile: process.env.APPARMOR_PROFILE
      },
      logger
    );
    const artifactStorage = new ArtifactStorage(tempDir);
    const runStore = new RunStore(path.join(tempDir, 'runs.db'));
    const apiKeyStore = new ApiKeyStore();
    const rateLimiter = new RateLimiter();

    orchestrator = new Orchestrator(
      {
        sandbox,
        artifactStorage,
        runStore,
        apiKeyStore,
        rateLimiter
      },
      logger
    );
  });

  afterAll(async () => {
    // Cleanup temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should compile and execute Go code', async () => {
    const request: RunRequest = {
      language: 'go',
      code: 'package main\nimport "fmt"\nfunc main() { fmt.Println("Hello, World!") }'
    };

    const result = await orchestrator.createRun(request, 'test-key');

    expect(result.status).toBe('succeeded');
    expect(result.stdout).toContain('Hello, World!');
    expect(result.exit_code).toBe(0);
  });

  it('should handle Go compilation errors', async () => {
    const request: RunRequest = {
      language: 'go',
      code: 'package main\nfunc main() { fmt.Println("Missing import") }'
    };

    const result = await orchestrator.createRun(request, 'test-key');

    expect(result.status).toBe('failed');
    expect(result.stderr).toContain('undefined: fmt');
    expect(result.exit_code).toBe(1);
  });

  it('should handle Go runtime errors', async () => {
    const request: RunRequest = {
      language: 'go',
      code: 'package main\nimport "os"\nfunc main() { os.Exit(1) }'
    };

    const result = await orchestrator.createRun(request, 'test-key');

    expect(result.status).toBe('failed');
    expect(result.exit_code).toBe(1);
  });

  it('should pass command-line arguments to Go programs', async () => {
    const request: RunRequest = {
      language: 'go',
      code: `package main
import (
    "fmt"
    "os"
)
func main() {
    for i, arg := range os.Args[1:] {
        fmt.Printf("Arg %d: %s\\n", i, arg)
    }
}`,
      args: ['hello', 'world', 'test']
    };

    const result = await orchestrator.createRun(request, 'test-key');

    expect(result.status).toBe('succeeded');
    expect(result.stdout).toContain('Arg 0: hello');
    expect(result.stdout).toContain('Arg 1: world');
    expect(result.stdout).toContain('Arg 2: test');
  });

  it('should handle Go file operations', async () => {
    const request: RunRequest = {
      language: 'go',
      code: `package main
import (
    "os"
    "fmt"
)
func main() {
    err := os.WriteFile("outputs/test.txt", []byte("Hello from Go!"), 0644)
    if err != nil {
        fmt.Printf("Error: %v\\n", err)
        os.Exit(1)
    }
    fmt.Println("File created successfully")
}`,
    };

    const result = await orchestrator.createRun(request, 'test-key');

    expect(result.status).toBe('succeeded');
    expect(result.stdout).toContain('File created successfully');
    expect(result.artifacts.length).toBe(1);
    expect(result.artifacts[0].name).toBe('test.txt');
    expect(result.artifacts[0].size).toBe(14); // "Hello from Go!" is 14 bytes
  });

  it('should respect resource limits for Go programs', async () => {
    const request: RunRequest = {
      language: 'go',
      code: `package main
import "time"
func main() {
    time.Sleep(10 * time.Second)
}`,
      limits: {
        timeout_ms: 1000,
        memory_mb: 256,
        cpu_ms: 5000,
        max_output_bytes: 1048576,
        max_artifact_bytes: 5242880,
        max_artifact_files: 10
      }
    };

    const result = await orchestrator.createRun(request, 'test-key');

    expect(result.status).toBe('timeout');
    expect(result.usage.wall_ms).toBeLessThanOrEqual(1100); // Allow small overhead
  });
});

