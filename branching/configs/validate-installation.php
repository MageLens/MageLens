<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

$environment = require 'app/etc/env.php';
$databaseHost = $environment['db']['connection']['default']['host'] ?? null;
$sessionStorage = $environment['session']['save'] ?? 'files';
if ($databaseHost !== 'db' || $sessionStorage !== 'files') {
    fwrite(STDERR, "Branching requires local db and file sessions\n");
    exit(1);
}
foreach ($environment['cache']['frontend'] ?? [] as $cache) {
    $server = $cache['backend_options']['server'] ?? null;
    if ($server !== null && $server !== 'redis') {
        exit(2);
    }
}
