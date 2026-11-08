<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

// Deterministic phpinfo configuration/module inventory from the serving FPM
// worker. Never collect INFO_ENVIRONMENT, INFO_VARIABLES or request/cache stats.
// Hash every directive value: third-party INI directives can contain secrets.
$ini = [];
foreach (ini_get_all(null, true) as $name => $value) {
    $ini[$name] = [
        'access' => $value['access'],
        'master' => hash('sha256', json_encode($value['global_value'], JSON_THROW_ON_ERROR)),
        'local' => hash('sha256', json_encode($value['local_value'], JSON_THROW_ON_ERROR)),
    ];
}
ksort($ini, SORT_STRING);
$extensions = [];
foreach (get_loaded_extensions() as $name) $extensions[$name] = phpversion($name) ?: null;
ksort($extensions, SORT_STRING);
header('Content-Type: application/json');
echo json_encode([
    'schemaVersion' => 1,
    'runtime' => ['php' => PHP_VERSION, 'zend' => zend_version(), 'sapi' => PHP_SAPI,
        'integerBytes' => PHP_INT_SIZE, 'threadSafe' => PHP_ZTS, 'debug' => PHP_DEBUG,
        'osFamily' => PHP_OS_FAMILY],
    'extensions' => $extensions,
    'ini' => $ini,
], JSON_THROW_ON_ERROR);
