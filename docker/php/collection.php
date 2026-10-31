<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);

function coverageCollectionLock(int $mode)
{
    $lock = fopen('/pcov-state/collection.lock', 'c+');
    if ($lock === false) throw new RuntimeException('Cannot open the coverage collection lock');
    $deadline = microtime(true) + 60;
    do {
        if (flock($lock, $mode | LOCK_NB)) return $lock;
        usleep(50000);
    } while (microtime(true) < $deadline);
    fclose($lock);
    throw new RuntimeException('Timed out waiting for active coverage requests to finish');
}

function stopCoverageCollection(): void
{
    $lock = coverageCollectionLock(LOCK_EX);
    try {
        if (is_file('/coverage/.active-run') && !unlink('/coverage/.active-run')) {
            throw new RuntimeException('Cannot stop coverage collection');
        }
    } finally {
        fclose($lock);
    }
}

function startCoverageCollection(): void
{
    $lock = coverageCollectionLock(LOCK_EX);
    try {
        $run = json_decode(file_get_contents('/coverage/run.json'), true, flags: JSON_THROW_ON_ERROR);
        if (!preg_match('/^[a-f0-9]{32}$/D', $run['id'] ?? '') || !is_file('/coverage/collector.json')) {
            throw new RuntimeException('Prepare the run and PHP collector before starting collection');
        }
        if (file_put_contents('/coverage/.active-run', $run['id']) === false) throw new RuntimeException('Cannot start coverage collection');
    } finally {
        fclose($lock);
    }
}

if (realpath($_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    match ($argv[1] ?? '') {
        'start' => startCoverageCollection(),
        'stop' => stopCoverageCollection(),
        default => throw new RuntimeException('Usage: collection.php start|stop'),
    };
}
