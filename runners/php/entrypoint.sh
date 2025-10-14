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
while (true) {
    $status = proc_get_status($process);
    if (!$status['running']) {
        break;
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
    'wall_ms' => (int)(($limits['timeout_ms'] ?? 5000)),
    'cpu_ms' => (int)($limits['cpu_ms'] ?? 5000),
    'max_rss_mb' => (int)($limits['memory_mb'] ?? 256)
];
file_put_contents('usage.json', json_encode($usage));

exit($status['exitcode'] ?? 0);
