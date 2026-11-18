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
