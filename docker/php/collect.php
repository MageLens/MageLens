<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);

// Installed only into this application's FPM SAPI. CLI setup and unrelated browser
// requests cannot contribute to the report.
$token = $_SERVER['HTTP_X_APPLICATION_COVERAGE'] ?? $_COOKIE['application_coverage'] ?? '';
if (PHP_SAPI !== 'fpm-fcgi' || !is_string($token) || !preg_match('/^[a-f0-9]{32}$/D', $token)) {
    return;
}
require_once __DIR__ . '/collection.php';
$collectionLock = coverageCollectionLock(LOCK_SH);
$active = @file_get_contents('/coverage/.active-run');
if ($active === false || !hash_equals(trim($active), $token)) {
    fclose($collectionLock);
    return;
}
$record = '/coverage/raw/php/' . $token . '/' . bin2hex(random_bytes(16));
if (!function_exists('pcov\\export')) {
    file_put_contents($record . '.error', 'VitaliyBoyko PCOV native export is unavailable');
    return;
}
$state = json_decode(file_get_contents('/coverage/collector.json'), true, flags: JSON_THROW_ON_ERROR);
pcov\start();
// Retain the shared lock until request shutdown. Reporting takes an exclusive
// lock and closes the run, without terminating or restarting the FPM worker.
register_shutdown_function(static function () use ($record, $token, $state, $collectionLock): void {
    pcov\stop();
    try {
        $result = pcov\export($record . '.pcov', $state['manifest'], $state['identity']['id'], pcov\inclusive, array_keys($state['scope']));
        if ($result === false) {
            throw new RuntimeException('Native PCOV export failed');
        }
        // Native exports are private by default; allow the host/reporting UID
        // to read these local coverage artifacts after the FPM worker finishes.
        if (!chmod($record . '.pcov', 0644)) {
            throw new RuntimeException('Cannot make the request record readable by the reporting container');
        }
        file_put_contents($record . '.json', json_encode([
            'run' => $token,
            'uri' => $_SERVER['REQUEST_URI'],
            'method' => $_SERVER['REQUEST_METHOD'],
            'status' => http_response_code(),
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
