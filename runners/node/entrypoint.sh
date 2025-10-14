#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { chdir, env, exit } from 'process';
import { spawn } from 'child_process';
import { tmpdir } from 'os';

const spec = JSON.parse(readFileSync(0, 'utf8'));
const limits = spec.limits ?? {};
chdir('/work');

const allowedEnv = spec.env ?? {};
for (const key of Object.keys(process.env)) {
  delete env[key];
}
for (const [key, value] of Object.entries(allowedEnv)) {
  env[key] = value;
}
env['HOME'] = '/work';
env['TMPDIR'] = '/work/tmp';
env['PATH'] = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

mkdirSync('tmp', { recursive: true });
mkdirSync('outputs', { recursive: true });

const args = ['main.js', '--', ...(spec.args ?? [])];
const child = spawn('node', args, { stdio: ['ignore', 'pipe', 'pipe'] });
let stdout: Buffer[] = [];
let stderr: Buffer[] = [];
child.stdout.on('data', (chunk) => stdout.push(chunk));
child.stderr.on('data', (chunk) => stderr.push(chunk));

const timeout = setTimeout(() => {
  child.kill('SIGKILL');
}, (limits.timeout_ms ?? 5000));

child.on('exit', (code) => {
  clearTimeout(timeout);
  const limit = limits.max_output_bytes ?? 1024 * 1024;
  const out = Buffer.concat(stdout).subarray(0, limit);
  const err = Buffer.concat(stderr).subarray(0, limit);
  process.stdout.write(out);
  process.stderr.write(err);
  const usage = {
    wall_ms: limits.timeout_ms ?? 5000,
    cpu_ms: limits.cpu_ms ?? 5000,
    max_rss_mb: limits.memory_mb ?? 256
  };
  writeFileSync('usage.json', JSON.stringify(usage));
  exit(code ?? 0);
});
