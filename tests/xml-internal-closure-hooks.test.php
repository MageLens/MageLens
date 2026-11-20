<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
$counts = ['bind' => 0, 'bindTo' => 0, 'call' => 0, '__invoke' => 0];
$registered = [];
$nativeOnly = in_array('--without-collector', $argv, true);
if (!$nativeOnly) foreach (array_keys($counts) as $method) {
    $registered[$method] = OpenTelemetry\Instrumentation\hook(Closure::class, $method,
        static function () use (&$counts, $method): void { $counts[$method]++; });
}
$target = new class { protected int $value = 0; public function value(): int { return $this->value; } };
$write = static function ($object, int $value): void { $object->value = $value; };
$bound = Closure::bind($write, null, get_class($target));
$bound($target, 1);
if ($target->value() !== 1) throw new RuntimeException('Native static binding effect changed');
$rebound = $write->bindTo(null, get_class($target));
$rebound($target, 2);
if ($target->value() !== 2) throw new RuntimeException('Native rebinding effect changed');
(function (): void { $this->value = 3; })->call($target);
if ($target->value() !== 3) throw new RuntimeException('Native scoped closure writes failed');
if (!$nativeOnly && ($registered !== array_fill_keys(array_keys($counts), true)
    || $counts !== ['bind' => 1, 'bindTo' => 1, 'call' => 1, '__invoke' => 0])) {
    throw new RuntimeException('Pinned scoped closure observation capability changed');
}
echo $nativeOnly ? "Native scoped writes succeed without instrumentation.\n"
    : "Native scoped writes succeed; bind/bindTo/call can be observed, but direct closure execution has no __invoke evidence.\n";
echo json_encode(['registered' => $registered, 'observed' => $counts]), "\n";
