<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

function drainCheckpointQueues(object $resource, object $factory): array
{
    // TODO: Discover checkpoint-safe consumers from the installed project's queue
    // configuration instead of hardcoding names; retain state and convergence checks.
    $allowed = ['sales.rule.update.coupon.usage', 'sales.rule.quote.trigger.recollect',
        'inventory.reservations.updateSalabilityStatus', 'inventory.reservations.update',
        'inventory.indexer.sourceItem', 'inventory.indexer.stock', 'inventory.source.items.cleanup'];
    $database = $resource->getConnection();
    $drained = [];
    for ($round = 0; $round < 8; $round++) {
        $query = $database->select()->from(['s' => $resource->getTableName('queue_message_status')], ['status', 'count' => 'COUNT(*)'])
            ->join(['q' => $resource->getTableName('queue')], 'q.id = s.queue_id', ['name'])
            ->where('s.status NOT IN (?)', [4, 7])->group(['q.name', 's.status'])->order(['q.name', 's.status']);
        $pending = $database->fetchAll($query);
        if (!$pending) return $drained;
        foreach ($pending as $queue) {
            $count = filter_var($queue['count'], FILTER_VALIDATE_INT);
            if ((string)$queue['status'] !== '2' || !in_array($queue['name'], $allowed, true) ||
                $count === false || $count < 1 || $count >= 10000) {
                throw new RuntimeException('Unqualified checkpoint queue state');
            }
            $factory->get($queue['name'])->process($count);
            $drained[] = ['name' => $queue['name'], 'count' => $count];
        }
    }
    throw new RuntimeException('Queue drain did not converge');
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    require '/var/www/html/app/bootstrap.php';
    $manager = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
    $manager->get(Magento\Framework\App\State::class)->setAreaCode('global');
    echo json_encode(drainCheckpointQueues(
        $manager->get(Magento\Framework\App\ResourceConnection::class),
        $manager->get(Magento\Framework\MessageQueue\ConsumerFactory::class)
    ), JSON_THROW_ON_ERROR);
}
