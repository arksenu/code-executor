import Boom from '@hapi/boom';
import { RunLimits } from './types.js';

export const DEFAULT_LIMITS: RunLimits = {
  timeout_ms: 5000,
  memory_mb: 256,
  cpu_ms: 5000,
  max_output_bytes: 1024 * 1024,
  max_artifact_bytes: 5 * 1024 * 1024,
  max_artifact_files: 10
};

export const MAX_LIMITS: RunLimits = {
  timeout_ms: 10000,
  memory_mb: 512,
  cpu_ms: 20000,
  max_output_bytes: 2 * 1024 * 1024,
  max_artifact_bytes: 20 * 1024 * 1024,
  max_artifact_files: 10
};

export function mergeLimits(input: Partial<RunLimits> | undefined): RunLimits {
  const merged: RunLimits = { ...DEFAULT_LIMITS, ...(input ?? {}) };
  if (merged.timeout_ms > MAX_LIMITS.timeout_ms) {
    throw Boom.badRequest('timeout_ms exceeds maximum');
  }
  if (merged.memory_mb > MAX_LIMITS.memory_mb) {
    throw Boom.badRequest('memory_mb exceeds maximum');
  }
  if (merged.cpu_ms > MAX_LIMITS.cpu_ms) {
    throw Boom.badRequest('cpu_ms exceeds maximum');
  }
  if (merged.max_output_bytes > MAX_LIMITS.max_output_bytes) {
    throw Boom.badRequest('max_output_bytes exceeds maximum');
  }
  if (merged.max_artifact_bytes > MAX_LIMITS.max_artifact_bytes) {
    throw Boom.badRequest('max_artifact_bytes exceeds maximum');
  }
  if (merged.max_artifact_files > MAX_LIMITS.max_artifact_files) {
    throw Boom.badRequest('max_artifact_files exceeds maximum');
  }
  return merged;
}
