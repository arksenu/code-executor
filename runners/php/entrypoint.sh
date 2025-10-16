#!/usr/bin/env php
<?php
$spec = json_decode(stream_get_contents(STDIN), true);
$limits = $spec['limits'] ?? [];
chdir('/work');

$_ENV = [];
foreach ($spec['env'] ?? [] as $key => $value) {
    putenv($key . '=' . $value);
    $_ENV[$key] = $value;
}
putenv('HOME=/work');
putenv('TMPDIR=/work/tmp');
putenv('PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin');

if (!is_dir('tmp')) { mkdir('tmp', 0700, true); }
if (!is_dir('outputs')) { mkdir('outputs', 0700, true); }

$HZ = 100; // Linux clock ticks per second (typical)
function read_cpu_jiffies($pid) {
    try {
        $stat = @file_get_contents("/proc/$pid/stat");
        if ($stat === false) { return null; }
        $rp = strrpos($stat, ')');
        if ($rp === false) { return null; }
        $rest = trim(substr($stat, $rp + 2));
        $parts = preg_split('/\s+/', $rest);
        $utime = isset($parts[11]) ? (int)$parts[11] : 0;
        $stime = isset($parts[12]) ? (int)$parts[12] : 0;
        return $utime + $stime;
    } catch (Throwable $e) {
        return null;
    }
}

function read_vm_hwm_kb($pid) {
    try {
        $status = @file_get_contents("/proc/$pid/status");
        if ($status === false) { return null; }
        if (preg_match('/^VmHWM:\s+(\d+)\s+kB/m', $status, $m)) {
            return (int)$m[1];
        }
        return null;
    } catch (Throwable $e) {
        return null;
    }
}

$cmd = ['php', 'main.php', '--'];
foreach (($spec['args'] ?? []) as $arg) {
    $cmd[] = $arg;
}
$descriptor = [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
$process = proc_open($cmd, $descriptor, $pipes);
if (!is_resource($process)) {
    fwrite(STDERR, 'failed to launch php');
    exit(1);
}
[$stdinPipe, $stdoutPipe, $stderrPipe] = $pipes;
fclose($stdinPipe);

$timeout = ($limits['timeout_ms'] ?? 5000) / 1000.0;
$start = microtime(true);
$status = null;
$cpuJiffies = 0;
$maxRssKb = 0;
while (true) {
    $status = proc_get_status($process);
    if (!$status['running']) {
        break;
    }
    $pid = $status['pid'] ?? null;
    if ($pid) {
        $cj = read_cpu_jiffies($pid);
        if ($cj !== null) { $cpuJiffies = $cj; }
        $rss = read_vm_hwm_kb($pid);
        if ($rss !== null && $rss > $maxRssKb) { $maxRssKb = $rss; }
    }
    if ((microtime(true) - $start) > $timeout) {
        proc_terminate($process, 9);
        $status = proc_get_status($process);
        $status['exitcode'] = 124;
        break;
    }
    usleep(10000);
}

$stdout = stream_get_contents($stdoutPipe);
$stderr = stream_get_contents($stderrPipe);
if (is_resource($stdoutPipe)) { fclose($stdoutPipe); }
if (is_resource($stderrPipe)) { fclose($stderrPipe); }

$limit = $limits['max_output_bytes'] ?? 1024 * 1024;
$stdout = substr($stdout ?? '', 0, $limit);
$stderr = substr($stderr ?? '', 0, $limit);

fwrite(STDOUT, $stdout);
fwrite(STDERR, $stderr);

$usage = [
    'wall_ms' => (int)round((microtime(true) - $start) * 1000),
    'cpu_ms' => (int)round(($cpuJiffies ?? 0) * (1000 / $HZ)),
    'max_rss_mb' => (int)max(0, round(($maxRssKb ?? 0) / 1024))
];
file_put_contents('usage.json', json_encode($usage));

exit($status['exitcode'] ?? 0);
