#!/usr/bin/env python3
import json
import os
import resource
import subprocess
import sys
import time
from pathlib import Path

WORKDIR = Path('/work')
SPEC = json.load(sys.stdin)
LIMITS = SPEC.get('limits', {})

os.chdir(WORKDIR)

env = {key: value for key, value in SPEC.get('env', {}).items()}
os.environ.clear()
os.environ.update(env)
os.environ['HOME'] = '/work'
os.environ['TMPDIR'] = '/work/tmp'
os.environ['PATH'] = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

(Path('tmp')).mkdir(parents=True, exist_ok=True)
(Path('outputs')).mkdir(parents=True, exist_ok=True)

memory_bytes = int(LIMITS.get('memory_mb', 256) * 1024 * 1024)
cpu_ms = int(LIMITS.get('cpu_ms', 5000))
cpu_quota_seconds = max(1, cpu_ms // 1000 or 1)
resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
resource.setrlimit(resource.RLIMIT_DATA, (memory_bytes, memory_bytes))
resource.setrlimit(resource.RLIMIT_FSIZE, (50 * 1024 * 1024, 50 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_NPROC, (32, 32))
resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))
resource.setrlimit(resource.RLIMIT_CPU, (cpu_quota_seconds, cpu_quota_seconds))

cmd = ['python3', 'main.py', '--', *SPEC.get('args', [])]
start = time.time()
proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=False)
try:
    timeout = LIMITS.get('timeout_ms', 5000) / 1000
    stdout, stderr = proc.communicate(timeout=timeout)
except subprocess.TimeoutExpired:
    proc.kill()
    stdout, stderr = proc.communicate()
    sys.stderr.buffer.write(b'Execution timed out')
    sys.exit(124)
end = time.time()

stdout = stdout[: int(LIMITS.get('max_output_bytes', 1024 * 1024))]
stderr = stderr[: int(LIMITS.get('max_output_bytes', 1024 * 1024))]

sys.stdout.buffer.write(stdout)
sys.stderr.buffer.write(stderr)

children_usage = resource.getrusage(resource.RUSAGE_CHILDREN)
cpu_ms = int((children_usage.ru_utime + children_usage.ru_stime) * 1000)
usage = {
    'wall_ms': int((end - start) * 1000),
    'cpu_ms': cpu_ms,
    'max_rss_mb': int(children_usage.ru_maxrss / 1024)
}
(Path('usage.json')).write_text(json.dumps(usage))

sys.exit(proc.returncode or 0)
