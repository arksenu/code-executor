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

# Setup environment
env = {key: value for key, value in SPEC.get('env', {}).items()}
os.environ.clear()
os.environ.update(env)
os.environ['HOME'] = '/work'
os.environ['TMPDIR'] = '/work/tmp'
os.environ['PATH'] = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/local/go/bin'
os.environ['GOPATH'] = '/work/tmp/go'
os.environ['GOCACHE'] = '/work/tmp/go-cache'
# Set Go memory limit to work in constrained environments
os.environ['GOMEMLIMIT'] = f"{LIMITS.get('memory_mb', 256) * 1024 * 1024}B"
# Disable memory profiling to reduce overhead
os.environ['GOGC'] = '50'

Path('tmp').mkdir(parents=True, exist_ok=True)
Path('outputs').mkdir(parents=True, exist_ok=True)

# Set resource limits
memory_bytes = int(LIMITS.get('memory_mb', 256) * 1024 * 1024)
cpu_ms = int(LIMITS.get('cpu_ms', 5000))
cpu_quota_seconds = max(1, cpu_ms // 1000 or 1)
# Comment out RLIMIT_AS as it can interfere with Go's memory allocator
# resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
resource.setrlimit(resource.RLIMIT_DATA, (memory_bytes, memory_bytes))
resource.setrlimit(resource.RLIMIT_FSIZE, (50 * 1024 * 1024, 50 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_NPROC, (256, 256))
resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))
resource.setrlimit(resource.RLIMIT_CPU, (cpu_quota_seconds, cpu_quota_seconds))

# COMPILATION PHASE
compile_start = time.time()
# Use build flags to reduce memory usage during compilation
compile_cmd = ['go', 'build', '-ldflags', '-s -w', '-o', 'main', 'main.go']

compile_proc = subprocess.Popen(
    compile_cmd, 
    stdout=subprocess.PIPE, 
    stderr=subprocess.PIPE,
    text=False
)

try:
    # Give compilation 10 seconds max
    compile_stdout, compile_stderr = compile_proc.communicate(timeout=10)
except subprocess.TimeoutExpired:
    compile_proc.kill()
    sys.stderr.buffer.write(b'Compilation timed out\n')
    sys.exit(124)

# Check compilation result
if compile_proc.returncode != 0:
    # Compilation failed - report compilation errors
    sys.stderr.buffer.write(b'Compilation failed:\n')
    sys.stderr.buffer.write(compile_stderr[:LIMITS.get('max_output_bytes', 1024 * 1024)])
    sys.exit(1)

compile_time = time.time() - compile_start

# EXECUTION PHASE
run_cmd = ['./main'] + SPEC.get('args', [])
start = time.time()
proc = subprocess.Popen(run_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=False)

try:
    timeout = LIMITS.get('timeout_ms', 5000) / 1000
    stdout, stderr = proc.communicate(timeout=timeout)
except subprocess.TimeoutExpired:
    proc.kill()
    stdout, stderr = proc.communicate()
    sys.stderr.buffer.write(b'Execution timed out\n')
    sys.exit(124)

end = time.time()

# Truncate output if needed
stdout = stdout[:int(LIMITS.get('max_output_bytes', 1024 * 1024))]
stderr = stderr[:int(LIMITS.get('max_output_bytes', 1024 * 1024))]

sys.stdout.buffer.write(stdout)
if stderr:
    sys.stderr.buffer.write(stderr)

# Report usage including compilation time
children_usage = resource.getrusage(resource.RUSAGE_CHILDREN)
cpu_ms = int((children_usage.ru_utime + children_usage.ru_stime) * 1000)
usage = {
    'wall_ms': int((end - start) * 1000),
    'compile_ms': int(compile_time * 1000),
    'cpu_ms': cpu_ms,
    'max_rss_mb': int(children_usage.ru_maxrss / 1024)
}
Path('usage.json').write_text(json.dumps(usage))

sys.exit(proc.returncode or 0)
