<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
require '/var/www/html/app/bootstrap.php';
$hooks = dirname(getenv('MAGELENS_XML_HOOKS') ?: __DIR__ . '/../docker/php/xml-hooks.php');
require $hooks . '/xml-hooks.php';

use MageLens\XmlCoverage\LayoutCoverage;
use Magento\Framework\Data\Structure as Storage;

$seed = new Storage();
$seed->createElement('root', ['type' => 'container']);
$seed->createElement('source', ['type' => 'block']);
$seed->setAsChild('source', 'root', 'child');
$elements = $seed->exportElements();
$calls = 0;
$type = new ReflectionClass(Storage::class);
$lazy = $type->newLazyGhost(static function ($object) use (&$calls, $elements): void {
    $calls++;
    $object->importElements($elements);
});
$inspect = new ReflectionMethod(LayoutCoverage::class, 'moveStorage');
if (!in_array('--without-collector', $argv, true)) {
    if ($inspect->invoke(null, $lazy, Storage::class, '_elements') !== null || $calls !== 0) {
        throw new RuntimeException('Move provenance initialized native lazy structure before its native consumer');
    }
}
if (!$lazy->hasElement('source') || $lazy->getParentId('source') !== 'root'
    || $lazy->getChildId('root', 'child') !== 'source' || $calls !== 1) {
    throw new RuntimeException('Native structure initialization or topology changed');
}
echo "Verified native structure initializes once at its own consumer and retains parent/alias topology.\n";
if (in_array('--without-collector', $argv, true)) exit;
if ($inspect->invoke(null, $lazy, Storage::class, '_elements') !== $elements || $calls !== 1) {
    throw new RuntimeException('Initialized native move storage lost its passive inspection');
}
echo "Verified move metadata inspection preserves pending lazy initialization and reads initialized native storage.\n";
