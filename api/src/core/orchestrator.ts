import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Boom from '@hapi/boom';
import { mergeLimits } from './limits.js';
import type { RunRequest, RunRecord, StreamCallback } from './types.js';
import { ArtifactStorage } from './storage.js';
import { Logger } from '../util/logger.js';
import type { SandboxRunner } from './types.js';

export interface OrchestratorOptions {
  workRoot: string;
  artifactStorage: ArtifactStorage;
  sandboxRunner: SandboxRunner;
  logger: Logger;
}

function generateId(length: number): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(length);
  let id = '';
  for (let i = 0; i < length; i++) {
    id += alphabet[bytes[i] % alphabet.length];
  }
  return id;
}

export class Orchestrator {
  constructor(private readonly options: OrchestratorOptions) {
    fs.mkdirSync(this.options.workRoot, { recursive: true });
    this.options.artifactStorage.ensureBaseDir();
  }

  public async createRun(request: RunRequest, apiKey: string): Promise<RunRecord> {
    this.validateRequest(request);
    const limits = mergeLimits(request.limits);
    const runId = `run_${generateId(12)}`;
    const workdir = path.join(this.options.workRoot, runId);
    fs.mkdirSync(path.join(workdir, 'inputs'), { recursive: true });
    fs.mkdirSync(path.join(workdir, 'outputs'), { recursive: true });

    const stagedFiles = this.stageInputFiles(request.files ?? [], workdir);

    const codeSha256 = crypto.createHash('sha256').update(request.code).digest('hex');
    const env = this.buildEnvironment(request.env);

    const result = await this.options.sandboxRunner.run({
      id: runId,
      language: request.language,
      code: request.code,
      args: request.args ?? [],
      env,
      workdir,
      limits,
      stagedFiles
    });

    const artifacts = [];
    let totalArtifactBytes = 0;
    for (const artifact of result.artifacts) {
      if (!artifact.path.startsWith(workdir)) {
        this.options.logger.warn('discarding artifact outside workdir', { artifact: artifact.path, runId });
        continue;
      }
      const relative = path.relative(path.join(workdir, 'outputs'), artifact.path);
      if (relative.startsWith('..')) {
        continue;
      }
      if (artifacts.length >= limits.max_artifact_files) {
        break;
      }
      if (totalArtifactBytes + artifact.size > limits.max_artifact_bytes) {
        break;
      }
      const stored = this.options.artifactStorage.moveArtifact(artifact.path, artifact.name, artifact.contentType);
      artifacts.push(stored);
      totalArtifactBytes += artifact.size;
    }

    const runRecord: RunRecord = {
      id: runId,
      status: result.status,
      exit_code: result.exitCode ?? 0,
      stdout: result.stdout.toString('utf8'),
      stderr: result.stderr.toString('utf8'),
      usage: result.usage,
      artifacts,
      limits,
      created_at: new Date().toISOString(),
      language: request.language,
      code_sha256: codeSha256
    };

    this.options.logger.info('run completed', { runId, status: runRecord.status, apiKey });
    fs.rm(workdir, { recursive: true, force: true }, () => undefined);
    return runRecord;
  }

  public async createRunWithStreaming(request: RunRequest, apiKey: string, streamCallback: StreamCallback): Promise<RunRecord> {
    this.validateRequest(request);
    const limits = mergeLimits(request.limits);
    const runId = `run_${generateId(12)}`;
    const workdir = path.join(this.options.workRoot, runId);
    fs.mkdirSync(path.join(workdir, 'inputs'), { recursive: true });
    fs.mkdirSync(path.join(workdir, 'outputs'), { recursive: true });

    const stagedFiles = this.stageInputFiles(request.files ?? [], workdir);

    const codeSha256 = crypto.createHash('sha256').update(request.code).digest('hex');
    const env = this.buildEnvironment(request.env);

    const result = await this.options.sandboxRunner.run({
      id: runId,
      language: request.language,
      code: request.code,
      args: request.args ?? [],
      env,
      workdir,
      limits,
      stagedFiles,
      streamCallback
    });

    const artifacts = [];
    let totalArtifactBytes = 0;
    for (const artifact of result.artifacts) {
      if (!artifact.path.startsWith(workdir)) {
        this.options.logger.warn('discarding artifact outside workdir', { artifact: artifact.path, runId });
        continue;
      }
      const relative = path.relative(path.join(workdir, 'outputs'), artifact.path);
      if (relative.startsWith('..')) {
        continue;
      }
      if (artifacts.length >= limits.max_artifact_files) {
        break;
      }
      if (totalArtifactBytes + artifact.size > limits.max_artifact_bytes) {
        break;
      }
      const stored = this.options.artifactStorage.moveArtifact(artifact.path, artifact.name, artifact.contentType);
      artifacts.push(stored);
      totalArtifactBytes += artifact.size;
    }

    const runRecord: RunRecord = {
      id: runId,
      status: result.status,
      exit_code: result.exitCode ?? 0,
      stdout: result.stdout.toString('utf8'),
      stderr: result.stderr.toString('utf8'),
      usage: result.usage,
      artifacts,
      limits,
      created_at: new Date().toISOString(),
      language: request.language,
      code_sha256: codeSha256
    };

    this.options.logger.info('run completed', { runId, status: runRecord.status, apiKey });
    fs.rm(workdir, { recursive: true, force: true }, () => undefined);
    return runRecord;
  }

  private validateRequest(request: RunRequest) {
    if (!request.language) {
      throw Boom.badRequest('language is required');
    }
    if (!['python', 'node', 'ruby', 'php', 'go'].includes(request.language)) {
      throw Boom.badRequest('unsupported language');
    }
    if (!request.code) {
      throw Boom.badRequest('code is required');
    }
    if (Buffer.byteLength(request.code, 'utf8') > 200 * 1024) {
      throw Boom.badRequest('code exceeds 200 KiB');
    }
  }

  private stageInputFiles(requestedFiles: Array<{ id: string; path: string }>, workdir: string) {
    const staged: Array<{ sourcePath: string; destPath: string }> = [];
    let totalSize = 0;
    for (const file of requestedFiles) {
      if (file.path.includes('..') || path.isAbsolute(file.path)) {
        throw Boom.badRequest(`invalid file path: ${file.path}`);
      }
      const uploaded = this.options.artifactStorage.getUploadedFile(file.id);
      if (uploaded.size > 10 * 1024 * 1024) {
        throw Boom.badRequest(`file ${uploaded.name} exceeds 10 MiB`);
      }
      totalSize += uploaded.size;
      if (totalSize > 25 * 1024 * 1024) {
        throw Boom.badRequest('total file size exceeds 25 MiB');
      }
      staged.push({ sourcePath: uploaded.path, destPath: file.path });
    }
    return staged;
  }

  private buildEnvironment(env: Record<string, string> | undefined): Record<string, string> {
    const sanitized: Record<string, string> = { HOME: '/work', TMPDIR: '/work/tmp' };
    if (!env) {
      return sanitized;
    }
    for (const [key, value] of Object.entries(env)) {
      if (/^LD_/i.test(key)) {
        continue;
      }
      sanitized[key] = value;
    }
    return sanitized;
  }
}
