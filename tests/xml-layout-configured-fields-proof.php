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
require $hooks . '/xml-layout-manifest.php';

use MageLens\Compatibility\Model\LayoutConfiguredData;
use MageLens\XmlCoverage\{LayoutCoverage, LayoutManifest, LayoutRuntimeHooks, Recorder};
use Magento\Framework\View\Element\UiComponent\Argument\Interpreter\ConfigurableObject;

$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_grammar_configureddata.xml';
$source = file_get_contents(BP . '/' . $path);
$files = [['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
    'declarations' => LayoutManifest::declarations($path, $source)]];
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
if (!in_array('--without-collector', $argv, true)) foreach ($callbacks as [$class, $method, $pre, $post]) {
    if (!LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot observe configured value fixture');
}
$deliveries = [];
if (!LayoutRuntimeHooks::register(Magento\Framework\ObjectManagerInterface::class, 'create', null,
    static function ($manager, array $params, $result, ?Throwable $error) use (&$deliveries): void {
        if (($params[0] ?? null) !== LayoutConfiguredData::class) return;
        $trace = LayoutRuntimeHooks::trace(DEBUG_BACKTRACE_IGNORE_ARGS, 4);
        if (($trace[2]['class'] ?? null) !== ConfigurableObject::class || ($trace[2]['function'] ?? null) !== 'evaluate') return;
        $deliveries[] = [!$error && $result instanceof LayoutConfiguredData, $params[1] ?? null];
    })) throw new RuntimeException('Cannot observe native configured constructor handoff');
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
foreach ([Magento\Framework\App\Area::PART_CONFIG, Magento\Framework\App\Area::PART_DESIGN] as $part) $area->load($part);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$page = $objects->get(Magento\Framework\View\Result\PageFactory::class)->create(true, ['isIsolated' => true]);
$page->addHandle('coverageprobe_grammar_configureddata');
$block = $page->getLayout()->getBlock('magelens.layout.grammar.configureddata');
$value = $block->getData('value');
if ($deliveries !== [[true, ['data' => ['tag' => 'configured-data']]]]
    || !$value instanceof LayoutConfiguredData || $value->getData('tag') !== 'configured-data'
    || $source !== file_get_contents(BP . '/' . $path)) throw new RuntimeException('Native configured class, constructor map or source changed');
echo "Verified one native configured class selection, constructor argument map and supplied block value.\n";
if (in_array('--without-collector', $argv, true)) exit;
$collector->finish();
$events = array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue());
$expected = [
    '/page/body/block/arguments/argument/argument[1]' => ['layout-configured-argument-evaluated', 'layout-configured-class-selected'],
    '/page/body/block/arguments/argument/argument[1]/@name' => ['layout-configured-class-selected'],
    '/page/body/block/arguments/argument/argument[1]/@xsi:type' => ['layout-argument-type-evaluated'],
    '/page/body/block/arguments/argument/argument[2]' => ['layout-configured-argument-evaluated', 'layout-configured-argument-supplied'],
    '/page/body/block/arguments/argument/argument[2]/@name' => ['layout-configured-argument-supplied'],
    '/page/body/block/arguments/argument/argument[2]/@xsi:type' => ['layout-argument-type-evaluated'],
    '/page/body/block/arguments/argument/argument[2]/item/@xsi:type' => ['layout-argument-type-evaluated'],
];
foreach ($files[0]['declarations'] as $declaration) {
    $node = $declaration['node'];
    if (!isset($expected[$node])) continue;
    $actual = array_values(array_unique(array_column(array_filter($events, static fn($record) => $record['id'] === $declaration['id']), 'type')));
    if ($actual !== $expected[$node]) throw new RuntimeException('Missing configured child evidence at ' . $node . ': ' . implode(', ', $actual));
    unset($expected[$node]);
}
if ($expected) throw new RuntimeException('Configured child source inventory changed');
echo "Verified original nested values, names, type dispatch and native object manager handoff.\n";
