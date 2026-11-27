<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

require '/var/www/html/vendor/autoload.php';
require dirname(getenv('MAGELENS_XML_HOOKS') ?: (require __DIR__ . '/project-root.php') . '/docker/php/xml-hooks.php') . '/xml-hooks.php';

use MageLens\XmlCoverage\{LayoutFieldAccess, LayoutRegistryCoverage, LayoutRuntimeHooks, Xml};
use Magento\Framework\Config\Data;
use Magento\Framework\DataObject;
use Magento\Framework\View\Element\Template;
use Magento\Framework\View\Layout\PageType\Config;

$case = $argv[1] ?? 'block';
if ($case === 'block') {
    $access = new LayoutFieldAccess('_data', Magento\Framework\View\Element\AbstractBlock::class, 'Block data');
    $block = (new ReflectionClass(Template::class))->newInstanceWithoutConstructor();
    $block->setData('value', 'from XML');
    if ($access->unconfirmed($block)) throw new RuntimeException('Untouched block argument lost provenance');
    $writer = new class extends DataObject {
        public function replace(Template $block): void
        {
            $block->_data['value'] = 'from XML';
        }
    };
    $writer->replace($block);
    if ($block->getData('value') !== 'from XML' || !$access->unconfirmed($block)) {
        throw new RuntimeException('Cross-instance DataObject write retained XML read ownership');
    }
    echo "Verified equal-valued protected write from outside the block hierarchy.\n";
    exit;
}

if (!in_array($case, ['offset-set', 'offset-unset-restore'], true)) throw new InvalidArgumentException('Unknown mutation case');
$events = [];
$registry = new LayoutRegistryCoverage([], static fn() => ['area' => 'frontend', 'theme' => 'frontend/Magento/luma'],
    static function ($id, $effect) use (&$events): void { $events[$id][] = $effect; });
foreach ($registry->hooks() as [$class, $method, $pre, $post]) {
    if (!LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException("Cannot hook $class::$method");
}
$data = [
    'mutated' => ['id' => 'mutated', 'label' => 'XML label'],
    'control' => ['id' => 'control', 'label' => 'XML label'],
];
// Supply the already verified converter result to isolate native initialization and later mutation.
$storage = (new ReflectionClass(Data::class))->newInstanceWithoutConstructor();
(new ReflectionProperty(Data::class, '_data'))->setValue($storage, $data);
$sources = (new ReflectionProperty(LayoutRegistryCoverage::class, 'typeStorage'))->getValue($registry);
$sources[$storage] = ['hash' => Xml::scalarTreeSignature($data), 'rows' => [
    'mutated' => ['node' => 'm-node', 'id' => 'm-id', 'label' => 'm-label', 'parents' => [], 'fields' => []],
    'control' => ['node' => 'c-node', 'id' => 'c-id', 'label' => 'c-label', 'parents' => [], 'fields' => []],
]];
$types = (new Config($storage))->getPageTypes();
if ($case === 'offset-unset-restore') {
    unset($types['mutated']['label']);
    // Restore without a second observed accessor to exercise offsetUnset on its own.
    $restore = new class extends DataObject {
        public function label(DataObject $type): void { $type->_data['label'] = 'XML label'; }
    };
    $restore->label($types['mutated']);
} else {
    $types['mutated']['label'] = 'XML label';
}
foreach ($types as $id => $type) {
    if ($type->getData('label') !== 'XML label' || $type->getData('id') !== $id) {
        throw new RuntimeException('Native page type values changed');
    }
}
LayoutRuntimeHooks::assertHealthy();
$registry->finish();
if (($events['m-label'] ?? []) !== ['layout-page-type-applied']
    || ($events['m-id'] ?? []) !== ['layout-page-type-applied', 'layout-page-type-read']
    || ($events['c-label'] ?? []) !== ['layout-page-type-applied', 'layout-page-type-read']) {
    throw new RuntimeException("Page type mutation changed application evidence or retained read ownership ($case): " . json_encode($events));
}
echo "Verified page type application, mutation and untouched read control ($case).\n";
