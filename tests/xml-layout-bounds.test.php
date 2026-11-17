<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
require __DIR__ . '/../docker/php/xml-recorder.php';

use MageLens\XmlCoverage\Recorder;

$context = ['area' => 'frontend', 'theme' => 'frontend/MageLens/fixture'];
for ($index = 0; $index < 32768; $index++) Recorder::layout((string) $index, 'block-created', $context);
Recorder::layout('0', 'block-created', $context);
Recorder::layout('overflow', 'block-created', $context);
Recorder::layout('overflow-again', 'block-created', $context);
$events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
$errors = (new ReflectionProperty(Recorder::class, 'errors'))->getValue();
if (count($events) !== 32768 || reset($events)['hits'] !== 2 || count($errors) !== 1) {
    throw new RuntimeException('Layout evidence must remain bounded and preserve repeated hits before rejecting publication');
}
(new ReflectionProperty(Recorder::class, 'manifest'))->setValue(null, ['run' => 'test', 'id' => 'test']);
try {
    Recorder::finish();
    throw new LogicException('Overflow must reject publication');
} catch (RuntimeException $error) {
    if (!str_contains($error->getMessage(), '32768')) throw $error;
}
echo "Layout evidence bounds and publication failure passed.\n";
