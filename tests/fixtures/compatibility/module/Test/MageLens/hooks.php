<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);

if (($argv[1] ?? '') === 'prepare') {
    echo '{}';
}
if (($argv[1] ?? '') !== 'cleanup') {
    exit;
}

// These job and queue names are reserved for the disposable acceptance module.
require '/var/www/html/app/bootstrap.php';
$manager = \Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$resource = $manager->get(\Magento\Framework\App\ResourceConnection::class);
$db = $resource->getConnection();
$db->delete($resource->getTableName('cron_schedule'), ['job_code IN (?)' => ['magelens_probe', 'magelens_magerun_probe']]);
$db->delete($resource->getTableName('queue_message'), ['topic_name = ?' => 'magelens.probe']);
foreach (glob(BP . '/var/magelens-queue-*') as $marker) {
    if (preg_match('/^magelens-queue-[a-f0-9]{24}$/D', basename($marker)) && !unlink($marker)) {
        throw new RuntimeException('Cannot remove the queue probe marker');
    }
}
