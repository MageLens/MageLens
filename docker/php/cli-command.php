<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);

require_once __DIR__ . '/collection.php';

$request = json_decode(stream_get_contents(STDIN), true, flags: JSON_THROW_ON_ERROR);
$run = $request['run'] ?? '';
$tool = $request['tool'] ?? '';
$args = $request['args'] ?? [];
$timeout = $request['timeout'] ?? 0;
if (!is_string($run) || !preg_match('/^[a-f0-9]{32}$/D', $run)
    || !in_array($tool, ['magento', 'magerun'], true)
    || !is_array($args) || !array_is_list($args) || !$args
    || !is_int($timeout) || $timeout < 1 || $timeout > 300000) {
    throw new InvalidArgumentException('Invalid CLI request');
}
foreach ($args as $arg) {
    if (!is_string($arg) || str_contains($arg, "\0")) {
        throw new InvalidArgumentException('Invalid Magento argument');
    }
}
$lock = coverageCollectionLock(LOCK_SH);
if (trim((string) @file_get_contents('/coverage/.active-run')) !== $run) {
    throw new RuntimeException('This CLI command requires the active coverage run');
}
$id = bin2hex(random_bytes(16));
$entry = $tool === 'magerun' ? magerunPhar() : 'bin/magento';
putenv('MAGELENS_CLI_COVERAGE=' . $run . ':' . $id . ':' . $tool);

$stdout = tmpfile();
$stderr = tmpfile();
if ($stdout === false || $stderr === false) {
    throw new RuntimeException('Cannot open temporary command output');
}
$command = ['timeout', '--signal=TERM', '--kill-after=5s', ($timeout / 1000) . 's',
    PHP_BINARY, '-d', 'auto_prepend_file=' . __DIR__ . '/collect.php', $entry,
    '--no-ansi', '--no-interaction', ...$args];
$process = proc_open($command, [0 => ['file', '/dev/null', 'r'], 1 => $stdout, 2 => $stderr], $pipes, '/var/www/html');
if (!is_resource($process)) {
    throw new RuntimeException('Cannot start the Magento command');
}
$code = proc_close($process);
rewind($stdout);
rewind($stderr);
$output = stream_get_contents($stdout, 1024 * 1024 + 1);
$errors = stream_get_contents($stderr, 1024 * 1024 + 1);
if (strlen($output) > 1024 * 1024 || strlen($errors) > 1024 * 1024) {
    throw new RuntimeException('CLI output exceeded 1 MiB');
}
if ($code === 124 || $code === 137) {
    throw new RuntimeException('CLI command timed out');
}
$record = '/coverage/raw/php/' . $run . '/' . $id;
if (!is_file($record . '.pcov') || !is_file($record . '.json') || is_file($record . '.error')) {
    throw new RuntimeException('Missing CLI PHP coverage record. Inspect coverage/raw/php.');
}
echo json_encode(['code' => $code, 'stdout' => $output, 'stderr' => $errors],
    JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR), "\n";

function magerunPhar(): string
{
    $version = (string) getenv('MAGERUN_VERSION');
    $checksum = (string) getenv('MAGERUN_SHA256');
    if (!preg_match('/^[0-9]+\.[0-9]+\.[0-9]+$/D', $version) || !preg_match('/^[a-f0-9]{64}$/D', $checksum)) {
        throw new RuntimeException('Invalid n98-magerun2 version or checksum');
    }
    $path = "/bootstrap/n98-magerun2-$version.phar";
    if (is_file($path) && hash_file('sha256', $path) === $checksum) {
        return $path;
    }
    $temporary = tempnam('/bootstrap', 'magerun-');
    if ($temporary === false) {
        throw new RuntimeException('Cannot create an n98-magerun2 download file');
    }
    try {
        $url = "https://github.com/netz98/n98-magerun2/releases/download/$version/n98-magerun2.phar";
        $process = proc_open(['curl', '--fail', '--silent', '--show-error', '--location', '--retry', '2',
            '--connect-timeout', '10', '--max-time', '30', '--output', $temporary, $url],
            [0 => ['file', '/dev/null', 'r'], 1 => STDERR, 2 => STDERR], $pipes);
        if (!is_resource($process) || proc_close($process) !== 0 || hash_file('sha256', $temporary) !== $checksum) {
            throw new RuntimeException('Could not download or verify the pinned n98-magerun2 PHAR');
        }
        if (!rename($temporary, $path)) {
            throw new RuntimeException('Could not install n98-magerun2');
        }
    } finally {
        if (is_file($temporary)) {
            unlink($temporary);
        }
    }
    return $path;
}
