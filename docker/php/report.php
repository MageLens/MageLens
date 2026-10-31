<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
require '/opt/report/vendor/autoload.php';
require __DIR__ . '/manifest.php';
require __DIR__ . '/collection.php';
require __DIR__ . '/report-data.php';
stopCoverageCollection();

use SebastianBergmann\CodeCoverage\Report\Html\Facade;
use SebastianBergmann\CodeCoverage\Report\Clover;

$runData = json_decode(file_get_contents('/coverage/run.json'), true, flags: JSON_THROW_ON_ERROR);
$run = $runData['id'];
$state = json_decode(file_get_contents('/coverage/collector.json'), true, flags: JSON_THROW_ON_ERROR);
$records = glob("/coverage/raw/php/$run/*.pcov");
if (!$records || glob("/coverage/raw/php/$run/*.error")) {
    throw new RuntimeException('Missing or failed PHP collection. Inspect coverage/raw/php and PHP-FPM logs.');
}
if (applicationIdentity()['identity']['id'] !== $state['identity']['id']) {
    throw new RuntimeException('Deployment changed during the suite. Rerun coverage against stable sources and configuration.');
}
$merged = [];
$requests = [];
foreach ($records as $path) {
    $metadata = json_decode(file_get_contents(substr($path, 0, -5) . '.json'), true, flags: JSON_THROW_ON_ERROR);
    if ($metadata['run'] !== $run || $metadata['pcov'] !== phpversion('pcov')) {
        throw new RuntimeException('Stale request or incorrect PCOV distribution');
    }
    $record = pcov_record_load($path);
    if ($record['php_version_id'] !== PHP_VERSION_ID || $record['environment_id'] !== $state['identity']['id']) {
        throw new RuntimeException('Record runtime/deployment identity mismatch');
    }
    foreach ($record['records'] as $file => $lines) {
        foreach ($lines as $line => $hit) {
            $merged[$file][$line] = max($merged[$file][$line] ?? -1, $hit);
        }
    }
    $requests[] = $metadata;
}
if ($state['manifest']) {
    $result = pcov_manifest_merge($state['manifest'], $records);
    if (!$result['coverage_complete']) {
        // Keep the immutable manifest and raw evidence, but fence it from reuse.
        file_put_contents($state['manifestTarget'] . '.invalid', 'Native full fallback requires fresh discovery');
        throw new RuntimeException('Native full fallback detected. This result is incomplete; rerun coverage to rebuild the manifest.');
    }
    $merged = $result['coverage'];
} else {
    $files = array_keys($merged);
    sort($files, SORT_STRING);
    if (array_diff($files, array_keys($state['scope']))) throw new RuntimeException('PHP collection contains files outside the discovered scope');
    // Unvisited files belong in the report with zero hits. A native manifest is
    // reusable only once HTTP requests have discovered every file in its scope.
    if ($files === array_keys($state['scope'])) {
        // New immutable generations are published at unique paths, never overwritten.
        pcov_manifest_bootstrap($state['manifestTarget'], $state['identity']['id'], $records);
        if (pcov_record_load($state['manifestTarget'])['fingerprints'] !== $state['scope']) {
            throw new RuntimeException('Manifest fingerprints do not match the complete source inventory');
        }
        pcov_atomic_publish($state['manifestPointer'], $state['manifestTarget']);
    }
}
$runner = ($runData['runner'] ?? 'cypress') === 'playwright' ? 'Playwright' : 'Cypress';
$coverage = applicationPhpReportData($state['scope'], $merged, $runData['sources'], "$runner HTTP run $run");
(new Facade)->process($coverage, '/coverage/php');
(new Clover)->process($coverage, '/coverage/php/clover.xml');
$report = $coverage->getReport();
$total = $report->numberOfExecutableLines();
$covered = $report->numberOfExecutedLines();
file_put_contents('/coverage/php/coverage-summary.json', json_encode([
    'run' => $run, 'metric' => 'lines', 'lineScope' => 'php-only', 'sourceRoot' => '/source',
    'total' => $total, 'covered' => $covered,
    'percent' => $total ? round(100 * $covered / $total, 2) : 0, 'requests' => $requests,
    'collection' => $state['manifest'] ? 'manifest' : 'full-discovery',
    'deploymentId' => $state['identity']['id'], 'manifest' => $state['manifestTarget'],
    'cache' => array_count_values(array_column($requests, 'cache')),
    'undiscovered' => array_values(array_diff(array_keys($state['scope']), array_keys($merged))),
], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n");
file_put_contents('/coverage/php/merged-lines.json', json_encode($merged, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
$lines = [];
foreach ($coverage->getData()->lineCoverage() as $file => $hits) {
    $lines[substr($file, strlen('/source/'))] = (object) array_map(static fn(?array $tests): int => $tests ? 1 : 0, $hits);
}
file_put_contents('/coverage/php/line-coverage.json', json_encode($lines, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n");
printf("PHP: %d/%d lines (%.2f%%), %d HTTP records\n", $covered, $total, $total ? 100 * $covered / $total : 0, count($records));
