<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

$action = $argv[1] ?? '';
if ($action === 'prepare') {
    echo "{}\n";
    exit;
}
if (!in_array($action, ['before', 'cleanup'], true)) throw new RuntimeException('Expected before, prepare or cleanup');
require '/var/www/html/app/bootstrap.php';
$objects = \Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(\Magento\PageCache\Model\Cache\Type::class)->clean(
    \Zend_Cache::CLEANING_MODE_MATCHING_TAG,
    ['MAGELENS_LAYOUT_FPC']
);
echo "Removed run-owned layout page cache entries.\n";

if ($action !== 'cleanup') {
    exit;
}

// These job and queue names are reserved for the disposable acceptance module.
$resource = $objects->get(\Magento\Framework\App\ResourceConnection::class);
$db = $resource->getConnection();
$db->delete($resource->getTableName('cron_schedule'), ['job_code IN (?)' => ['magelens_probe', 'magelens_magerun_probe']]);
$db->delete($resource->getTableName('queue_message'), ['topic_name = ?' => 'magelens.probe']);
foreach (glob(BP . '/var/magelens-queue-*') as $marker) {
    if (preg_match('/^magelens-queue-[a-f0-9]{24}$/D', basename($marker)) && !unlink($marker)) {
        throw new RuntimeException('Cannot remove the queue probe marker');
    }
}
