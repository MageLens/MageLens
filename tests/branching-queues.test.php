<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
require __DIR__ . '/../branching/configs/retained-queues.php';

final class QueueResource
{
    public int $round = 0;
    public function __construct(public array $pending) {}
    public function getConnection(): self { return $this; }
    public function getTableName(string $name): string { return 'prefix_' . $name; }
    public function select(): self { return $this; }
    public function __call(string $name, array $args): self { return $this; }
    public function fetchAll(object $query): array { return $this->pending[$this->round++] ?? []; }
}
final class QueueFactory
{
    public array $calls = [];
    public function get(string $name): self { $this->calls[] = $name; return $this; }
    public function process(int $count): void { $this->calls[] = $count; }
}
function check(bool $condition): void { if (!$condition) throw new RuntimeException('Queue assertion failed'); }
function rejected(array $rounds): void {
    try { drainCheckpointQueues(new QueueResource($rounds), new QueueFactory()); }
    catch (RuntimeException $error) { check(str_contains($error->getMessage(), 'queue') || str_contains($error->getMessage(), 'Queue')); return; }
    throw new RuntimeException('Unsafe queue state accepted');
}
$row = ['name' => 'sales.rule.update.coupon.usage', 'count' => '3', 'status' => '2'];
$factory = new QueueFactory();
$result = drainCheckpointQueues(new QueueResource([[$row], [$row], []]), $factory);
check($result === array_fill(0, 2, ['name' => $row['name'], 'count' => 3]));
check($factory->calls === [$row['name'], 3, $row['name'], 3]);
foreach ([['name' => 'unknown.consumer'], ['status' => 3], ['status' => 5], ['status' => 6],
    ['count' => 0], ['count' => 10000], ['count' => '1.5']] as $override) rejected([[array_replace($row, $override)]]);
rejected(array_fill(0, 8, [$row]));
echo "Checkpoint queue batching checks passed\n";
