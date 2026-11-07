<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
require '/var/www/html/app/bootstrap.php';
$manager = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$resource = $manager->get(Magento\Framework\App\ResourceConnection::class);
$database = $resource->getConnection();
header('Content-Type: application/json');
if (($_SERVER['argv'][1] ?? '') === 'queues') {
    $query = $database->select()->from(['s' => $resource->getTableName('queue_message_status')], ['status', 'count' => 'COUNT(*)'])
        ->join(['q' => $resource->getTableName('queue')], 'q.id = s.queue_id', ['name'])
        ->where('s.status NOT IN (?)', [4, 7])->group(['q.name', 's.status'])->order(['q.name', 's.status']);
    echo json_encode($database->fetchAll($query), JSON_THROW_ON_ERROR);
} else {
    echo json_encode(['schema' => $database->fetchOne('SELECT DATABASE()'), 'pid' => getmypid(),
        'persistent' => $database->getConnection()->getAttribute(PDO::ATTR_PERSISTENT)], JSON_THROW_ON_ERROR);
}
