export type Language = 'python' | 'node' | 'ruby' | 'php';

export interface RunLimits {
  timeout_ms: number;
  memory_mb: number;
  cpu_ms: number;
  max_output_bytes: number;
  max_artifact_bytes: number;
  max_artifact_files: number;
}

export interface RunUsage {
  wall_ms: number;
  cpu_ms: number;
  max_rss_mb: number;
}

export type RunStatus = 'succeeded' | 'failed' | 'timeout' | 'oom' | 'killed';

export interface RunArtifact {
  name: string;
  size: number;
  sha256: string;
  url: string;
  expires_at: string;
  content_type: string;
}

export interface RunRequest {
  language: Language;
  code: string;
  args?: string[];
  files?: Array<{ id: string; path: string }>;
  limits?: Partial<RunLimits>;
  env?: Record<string, string>;
}

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  sha256: string;
  path: string;
  contentType: string;
}

export interface RunRecord {
  id: string;
  status: RunStatus;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  usage: RunUsage;
  artifacts: RunArtifact[];
  limits: RunLimits;
  created_at: string;
  language: Language;
  code_sha256: string;
}

export interface SandboxResult {
  status: RunStatus;
  exitCode: number | null;
  stdout: Buffer;
  stderr: Buffer;
  usage: RunUsage;
  artifacts: Array<{ path: string; name: string; size: number; contentType?: string }>;
}

export interface SandboxRunSpec {
  id: string;
  language: Language;
  code: string;
  args: string[];
  env: Record<string, string>;
  workdir: string;
  limits: RunLimits;
  stagedFiles: Array<{ sourcePath: string; destPath: string }>;
}

export interface SandboxRunner {
  run(spec: SandboxRunSpec): Promise<SandboxResult>;
}
