<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

// Run in a disposable container with writable /coverage and /pcov-state.
declare(strict_types=1);
require dirname(__DIR__) . '/docker/php/collection.php';
function check(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}
$run = str_repeat('a', 32);
file_put_contents('/coverage/run.json', json_encode(['id' => $run]));
file_put_contents('/coverage/collector.json', '{}');
startCoverageCollection();
check(file_get_contents('/coverage/.active-run') === $run, 'Collection did not start');
$child = proc_open([PHP_BINARY, '-r', <<<'PHP'
$lock=fopen('/pcov-state/collection.lock','c+');
flock($lock, LOCK_SH);
echo "locked\n"; flush();
usleep(300000);
file_put_contents('/coverage/export-finished', 'yes');
fclose($lock);
PHP], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
check(trim(fgets($pipes[1])) === 'locked', 'Request did not acquire collection lock');
stopCoverageCollection();
check(is_file('/coverage/export-finished'), 'Reporting raced ahead of an active request');
check(!is_file('/coverage/.active-run'), 'Collection remained active');
foreach ($pipes as $pipe) fclose($pipe);
check(proc_close($child) === 0, 'Request simulation failed');
stopCoverageCollection();
$run = str_repeat('b', 32);
file_put_contents('/coverage/run.json', json_encode(['id' => $run]));
startCoverageCollection();
check(file_get_contents('/coverage/.active-run') === $run, 'Next run retained the old token');
stopCoverageCollection();
echo "PASS: reporting waits for active requests; closing is idempotent; new runs use fresh tokens.\n";
