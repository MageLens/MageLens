<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);

// FPM is configured at image build time. CLI collection is enabled only for
// the specific Magento process started by the test command executor.
$commandId = $tool = null;
if (PHP_SAPI === 'cli') {
    $invocation = getenv('MAGELENS_CLI_COVERAGE', true);
    if (!is_string($invocation) || !preg_match('/^([a-f0-9]{32}):([a-f0-9]{32}):(magento|magerun)$/D', $invocation, $matches)) {
        return;
    }
    [, $token, $commandId, $tool] = $matches;
    // Child commands are outside this invocation and must not replace its record.
    putenv('MAGELENS_CLI_COVERAGE');
} elseif (PHP_SAPI === 'fpm-fcgi') {
    $token = $_SERVER['HTTP_X_APPLICATION_COVERAGE'] ?? $_COOKIE['application_coverage'] ?? '';
    if (!is_string($token) || !preg_match('/^[a-f0-9]{32}$/D', $token)) {
        return;
    }
} else {
    return;
}
require_once __DIR__ . '/collection.php';
$collectionLock = coverageCollectionLock(LOCK_SH);
$active = @file_get_contents('/coverage/.active-run');
if ($active === false || !hash_equals(trim($active), $token)) {
    fclose($collectionLock);
    return;
}
$record = '/coverage/raw/php/' . $token . '/' . ($commandId ?? bin2hex(random_bytes(16)));
if (!function_exists('pcov\\export')) {
    file_put_contents($record . '.error', 'VitaliyBoyko PCOV native export is unavailable');
    return;
}
$state = json_decode(file_get_contents('/coverage/collector.json'), true, flags: JSON_THROW_ON_ERROR);
require_once '/application/docker/php/xml-hooks.php';
try {
    startXmlHooks($token);
} catch (Throwable) {
    file_put_contents($record . '.error', 'Cannot initialize XML runtime hooks');
    return;
}
pcov\start();
// Retain the shared lock until process shutdown. Reporting takes an exclusive
// lock and closes the run, without terminating or restarting the FPM worker.
$initialPid = getmypid();
register_shutdown_function(static function () use ($initialPid, $record, $token, $state, $collectionLock, $commandId, $tool): void {
    if ($commandId !== null && getmypid() !== $initialPid) {
        $record .= '.' . getmypid();
    }
    pcov\stop();
    try {
        $xmlRecord = \MageLens\XmlCoverage\Recorder::finish($commandId !== null);
        $result = pcov\export($record . '.pcov', $state['manifest'], $state['identity']['id'], pcov\inclusive, array_keys($state['scope']));
        if ($result === false) {
            throw new RuntimeException('Native PCOV export failed');
        }
        // Native exports are private by default; allow the host/reporting UID
        // to read these local coverage artifacts after the FPM worker finishes.
        if (!chmod($record . '.pcov', 0644)) {
            throw new RuntimeException('Cannot make the request record readable by the reporting container');
        }
        $origin = $commandId === null ? [
            'uri' => $_SERVER['REQUEST_URI'],
            'method' => $_SERVER['REQUEST_METHOD'],
            'status' => http_response_code(),
        ] : ['commandId' => $commandId, 'tool' => $tool];
        file_put_contents($record . '.json', json_encode([
            'xml' => $xmlRecord,
            'run' => $token,
            ...$origin,
            'mode' => $result['mode'],
            'cache' => $result['cache'] ?? 'bypass',
            'reason' => $result['reason'],
            'pcov' => phpversion('pcov'),
        ], JSON_THROW_ON_ERROR));
    } catch (Throwable $error) {
        file_put_contents($record . '.error', $error->getMessage());
        error_log('Application coverage: ' . $error->getMessage());
    }
});
