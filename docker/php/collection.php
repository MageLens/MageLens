<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);

function coverageCollectionFailureSummary(array $files): string
{
    // Raw failures can contain private paths or exception arguments. Publish
    // only fixed collector reasons, never arbitrary error text.
    $known = [
        'Cached configuration differs from current provenance; use --refresh-cache',
        'Cached Admin structure differs from current XML provenance; use --refresh-cache',
        'Admin field source metadata was not observed before rendering',
        'Configuration changed during collection',
        'Cannot attribute configuration read',
        'Cannot attribute Admin field rendering',
        'Cannot attribute Admin field source metadata',
        'Native PCOV export failed',
        'VitaliyBoyko PCOV native export is unavailable',
    ];
    $reasons = [];
    $unknown = 0;
    foreach ($files as $file) {
        $text = @file_get_contents($file, false, null, 0, 16384);
        $matched = false;
        foreach ($known as $reason) if (is_string($text) && str_contains($text, $reason)) {
            $reasons[$reason] = true;
            $matched = true;
        }
        if (!$matched) $unknown++;
    }
    if ($unknown) $reasons['Other collector failures: ' . $unknown] = true;
    return count($files) . ' failed request records' . ($reasons ? ': ' . implode('; ', array_keys($reasons)) : '');
}

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
