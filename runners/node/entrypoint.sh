#!/usr/bin/env node
const { readFileSync, mkdirSync, writeFileSync } = require('fs');
const { chdir, env, exit } = require('process');
const { spawn } = require('child_process');

const spec = JSON.parse(readFileSync(0, 'utf8'));
const limits = spec.limits || {};
chdir('/work');

const allowedEnv = spec.env || {};
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

const HZ = 100; // Linux clock ticks per second (typical)
function readCpuJiffies(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rp = stat.lastIndexOf(')');
    if (rp === -1) return null;
    const rest = stat.slice(rp + 2).trim().split(/\s+/);
    const utime = parseInt(rest[11] || '0', 10);
    const stime = parseInt(rest[12] || '0', 10);
    if (Number.isNaN(utime) || Number.isNaN(stime)) return null;
    return utime + stime;
  } catch (_) {
    return null;
  }
}

function readVmHWMKb(pid) {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    const match = status.match(/^VmHWM:\s+(\d+)\s+kB/m);
    return match ? parseInt(match[1], 10) : null;
  } catch (_) {
    return null;
  }
}

const args = ['main.js', '--', ...((spec.args || []))];
const child = spawn('node', args, { stdio: ['ignore', 'pipe', 'pipe'] });
const stdoutChunks = [];
const stderrChunks = [];
child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

const startMs = Date.now();
let lastCpuJiffies = 0;
let maxRssKb = 0;

// Seed an initial sample immediately after spawn
(() => {
  const cj = readCpuJiffies(child.pid);
  if (cj !== null) lastCpuJiffies = cj;
  const rss = readVmHWMKb(child.pid);
  if (rss !== null) maxRssKb = Math.max(maxRssKb, rss);
})();

const sampler = setInterval(() => {
  const cj = readCpuJiffies(child.pid);
  if (cj !== null) lastCpuJiffies = cj;
  const rss = readVmHWMKb(child.pid);
  if (rss !== null) maxRssKb = Math.max(maxRssKb, rss);
}, 50);

let timedOut = false;
const timeout = setTimeout(() => {
  timedOut = true;
  child.kill('SIGKILL');
}, (limits.timeout_ms || 5000));

child.on('exit', (code) => {
  clearInterval(sampler);
  clearTimeout(timeout);
  const limit = limits.max_output_bytes || 1024 * 1024;
  const out = Buffer.concat(stdoutChunks).subarray(0, limit);
  const err = Buffer.concat(stderrChunks).subarray(0, limit);
  process.stdout.write(out);
  process.stderr.write(err);
  const wallMs = Date.now() - startMs;
  const cpuMs = Math.round((lastCpuJiffies || 0) * (1000 / HZ));
  const maxRssMb = Math.max(0, Math.round((maxRssKb || 0) / 1024));
  const usage = { wall_ms: wallMs, cpu_ms: cpuMs, max_rss_mb: maxRssMb };
  writeFileSync('usage.json', JSON.stringify(usage));
  exit((timedOut ? 124 : (code || 0)));
});
