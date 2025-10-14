import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import crypto from 'node:crypto';
import type { SandboxResult, SandboxRunSpec, SandboxRunner } from './types.js';
import { Logger } from '../util/logger.js';

const languageImageMap: Record<string, string> = {
  python: process.env.RUNNER_IMAGE_PYTHON ?? 'code-interpreter-runner-python:latest',
  node: process.env.RUNNER_IMAGE_NODE ?? 'code-interpreter-runner-node:latest',
  ruby: process.env.RUNNER_IMAGE_RUBY ?? 'code-interpreter-runner-ruby:latest',
  php: process.env.RUNNER_IMAGE_PHP ?? 'code-interpreter-runner-php:latest'
};

export interface DockerRunnerOptions {
  workRoot: string;
  seccompProfile: string;
  appArmorProfile?: string;
}

export class DockerSandbox implements SandboxRunner {
  constructor(private readonly options: DockerRunnerOptions, private readonly logger: Logger) { }

  public async run(spec: SandboxRunSpec): Promise<SandboxResult> {
    const image = languageImageMap[spec.language];
    const runDir = spec.workdir;
    fs.mkdirSync(runDir, { recursive: true });
    const codeFile = path.join(runDir, this.entryFileName(spec.language));
    fs.writeFileSync(codeFile, spec.code, { encoding: 'utf8' });
    this.stageFiles(runDir, spec.stagedFiles);
    const dockerArgs = this.buildDockerArgs(image, runDir, spec);
    this.logger.info('launching sandbox', { specId: spec.id, dockerArgs });
    const child = childProcess.spawn('docker', dockerArgs, {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    child.stdin.end(JSON.stringify({
      id: spec.id,
      args: spec.args,
      env: spec.env,
      limits: spec.limits
    }));

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    const [code, signal] = (await once(child, 'exit')) as [number | null, NodeJS.Signals | null];

    const stdout = Buffer.concat(stdoutChunks).slice(0, spec.limits.max_output_bytes);
    const stderr = Buffer.concat(stderrChunks).slice(0, spec.limits.max_output_bytes);

    let status: SandboxResult['status'] = 'succeeded';
    if (signal === 'SIGKILL') {
      status = 'timeout';
    }
    if (code === 137) {
      status = 'oom';
    } else if (code !== 0) {
      status = 'failed';
    }

    const usagePath = path.join(runDir, 'usage.json');
    let usage = { wall_ms: spec.limits.timeout_ms, cpu_ms: spec.limits.cpu_ms, max_rss_mb: spec.limits.memory_mb };
    if (fs.existsSync(usagePath)) {
      usage = JSON.parse(fs.readFileSync(usagePath, 'utf8'));
    }

    const artifacts = this.collectArtifacts(runDir);

    return {
      status,
      exitCode: code,
      stdout,
      stderr,
      usage,
      artifacts
    };
  }

  private buildDockerArgs(image: string, runDir: string, spec: SandboxRunSpec): string[] {
    const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const bytes = crypto.randomBytes(6);
    let suffix = '';
    for (let i = 0; i < 6; i++) {
      suffix += alphabet[bytes[i] % alphabet.length];
    }
    const containerName = `run_${spec.id}_${suffix}`;
    const disableSecurity = process.env.DISABLE_SANDBOX_SECURITY === '1';
    const hostSandbox = process.env.HOST_SANDBOX_DIR ?? runDir;
    const hostRunDir = path.join(hostSandbox, path.basename(runDir));
    const args: string[] = [
      'run',
      '-i',
      '--rm',
      '--name',
      containerName,
      '--network=none',
      '--read-only',
      '--pids-limit=32',
      '--cpus',
      (spec.limits.cpu_ms / 1000).toFixed(2),
      '--memory',
      `${spec.limits.memory_mb}m`,
      '--memory-swap',
      `${spec.limits.memory_mb}m`,
      '--cap-drop=ALL',
      '--mount',
      `type=bind,src=${hostRunDir},dst=/work`
    ];
    if (!disableSecurity) {
      args.push('--security-opt', 'no-new-privileges:true');
      args.push('--security-opt', `seccomp=${this.options.seccompProfile}`);
      if (this.options.appArmorProfile) {
        args.push('--security-opt', `apparmor=${this.options.appArmorProfile}`);
      }
    }
    args.push(image);
    args.push('--');
    return args;
  }

  private stageFiles(runDir: string, files: SandboxRunSpec['stagedFiles']) {
    for (const file of files) {
      if (file.destPath.includes('..') || path.isAbsolute(file.destPath)) {
        continue;
      }
      const dest = path.join(runDir, 'inputs', file.destPath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(file.sourcePath, dest);
    }
  }

  private collectArtifacts(runDir: string): SandboxResult['artifacts'] {
    const outputsDir = path.join(runDir, 'outputs');
    if (!fs.existsSync(outputsDir)) {
      return [];
    }
    const entries = fs.readdirSync(outputsDir, { withFileTypes: true });
    const artifacts: SandboxResult['artifacts'] = [];
    for (const entry of entries) {
      if (entry.isFile()) {
        const fullPath = path.join(outputsDir, entry.name);
        const stat = fs.statSync(fullPath);
        artifacts.push({ path: fullPath, name: entry.name, size: stat.size });
      }
    }
    return artifacts;
  }

  private entryFileName(language: SandboxRunSpec['language']): string {
    switch (language) {
      case 'python':
        return 'main.py';
      case 'node':
        return 'main.js';
      case 'ruby':
        return 'main.rb';
      case 'php':
        return 'main.php';
      default:
        return 'main.txt';
    }
  }
}
