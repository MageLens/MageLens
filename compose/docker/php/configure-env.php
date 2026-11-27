<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);

function coverageEnvironment(array $current, array $fragment, array $scopes): array
{
    // A copied shop can override defaults at website/store scope. Apply the
    // same local settings there without changing its theme or other settings.
    foreach (['websites', 'stores'] as $scope) {
        $codes = array_unique(array_merge(array_keys($current['system'][$scope] ?? []), $scopes[$scope] ?? []));
        foreach ($codes as $code) $fragment['system'][$scope][$code] = $fragment['system']['default'];
    }
    return array_replace_recursive($current, $fragment);
}

if (realpath($_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    require '/var/www/html/app/bootstrap.php';
    $om = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
    $resource = $om->get(Magento\Framework\App\ResourceConnection::class);
    $db = $resource->getConnection();
    $scopes = [];
    foreach (['websites' => 'store_website', 'stores' => 'store'] as $scope => $table) {
        $scopes[$scope] = $db->fetchCol($db->select()->from($resource->getTableName($table), ['code']));
    }
    $current = require BP . '/app/etc/env.php';
    $updated = coverageEnvironment($current, require __DIR__ . '/env.php.sample', $scopes);
    if ($updated !== $current) {
        $om->get(Magento\Framework\App\DeploymentConfig\Writer::class)->saveConfig([
            Magento\Framework\Config\File\ConfigFilePool::APP_ENV => $updated,
        ]);
    }
    echo "Applied local coverage settings from docker/php/env.php.sample.\n";
}
