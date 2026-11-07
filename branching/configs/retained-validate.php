<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
$environment = require 'app/etc/env.php';
$connections = $environment['db']['connection'] ?? [];
$database = $connections['default'] ?? [];
if (array_keys($connections) !== ['default'] || ($database['host'] ?? null) !== 'db'
    || ($database['dbname'] ?? null) !== 'magento' || ($database['username'] ?? null) !== 'magento'
    || !empty($database['persistent']) || !empty($database['driver_options'][PDO::ATTR_PERSISTENT])
    || ($environment['session']['save'] ?? 'files') !== 'files') {
    throw new RuntimeException('Retained branching requires one local, nonpersistent magento connection and file sessions');
}
if (!empty($environment['queue']['amqp']) || !empty($environment['queue']['stomp'])) {
    throw new RuntimeException('External message brokers require a checkpoint adapter');
}
foreach ($environment['cache']['frontend'] ?? [] as $cache) {
    $server = $cache['backend_options']['server'] ?? null;
    if ($server !== null && $server !== 'redis') {
        throw new RuntimeException('External caches require a checkpoint adapter');
    }
}
