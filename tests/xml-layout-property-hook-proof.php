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

use MageLens\XmlCoverage\{LayoutCoverage, LayoutManifest, Recorder};
use MageLens\Compatibility\Controller\Propertyownership\Index;
use Magento\Framework\App\Area;

$magic = null;
if (!OpenTelemetry\Instrumentation\hook(Magento\Framework\View\Element\AbstractBlock::class, 'toHtml', null,
    static function ($block) use (&$magic): void {
        if ($block instanceof MageLens\Compatibility\Block\LayoutDataPropertyMagic) $magic = $block;
    })) throw new RuntimeException('Cannot observe native property restoration fixture');

$files = [];
foreach (['native', 'template_get', 'template_set', 'template_magic', 'template_redeclared',
    'data_get', 'data_magic', 'data_set', 'data_redeclared', 'data_direct'] as $case) {
    $path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_propertyownership_' . $case . '.xml';
    $source = file_get_contents(BP . '/' . $path);
    $files[$case] = ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
        'declarations' => LayoutManifest::declarations($path, $source)];
}
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets(array_values($files)));
foreach ($callbacks as [$class, $method, $pre, $post]) {
    if (in_array('--without-collector', $argv, true)) continue;
    if (!OpenTelemetry\Instrumentation\hook($class, $method, $pre, $post)) throw new RuntimeException('Cannot register native property proof hook');
}
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
$area->load(Area::PART_CONFIG);
$area->load(Area::PART_DESIGN);
$cache = $objects->get(Magento\Framework\App\Cache\StateInterface::class);
foreach (['layout', 'block_html', 'full_page'] as $type) $cache->setEnabled($type, false);
$result = $objects->get(Index::class)->execute();
$output = (new ReflectionProperty(Magento\Framework\Controller\Result\Raw::class, 'contents'))->getRawValue($result);
if (substr_count($output, '>verified</span>') !== 11) throw new RuntimeException('Expected eleven native property storage outcomes');
if (!$magic instanceof MageLens\Compatibility\Block\LayoutDataPropertyMagic) throw new RuntimeException('Native magic storage fixture was bypassed');
$property = new ReflectionProperty(Magento\Framework\DataObject::class, '_data');
if ($property->isInitialized($magic)) throw new RuntimeException('Expected unset native data storage after magic rendering');
$replacement = (new ReflectionProperty(MageLens\Compatibility\Block\LayoutDataPropertyMagic::class, 'replacement'))->getRawValue($magic);
$property->setRawValue($magic, $replacement);
if ($property->isInitialized($magic) || $magic->getData('value') !== 'xml-value') {
    throw new RuntimeException('Raw reflection write unexpectedly bypassed native magic property access');
}
Index::$reads['data-magic'] = MageLens\Compatibility\Block\LayoutDataPropertyMagic::$reads;
echo "Verified raw reflection writes retain native magic access to unset property storage.\n";
echo "Verified native property hooks, magic replacement and plain redeclared storage.\n";
echo 'Native property reads: ', json_encode(Index::$reads, JSON_THROW_ON_ERROR), "\n";
if (in_array('--without-collector', $argv, true)) exit;
$expected = array_search('--expected-reads', $argv, true);
if ($expected !== false && Index::$reads !== json_decode($argv[$expected + 1], true, flags: JSON_THROW_ON_ERROR)) {
    throw new RuntimeException('Collector changed native property getter call counts');
}
$collector->finish();
$events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
foreach ($files as $case => $file) {
    foreach ($file['declarations'] as $declaration) {
        $kind = $declaration['layout']['kind'];
        if (!in_array($kind, ['template', 'argument', 'block-ttl'], true)) continue;
        $effects = array_values(array_unique(array_column(array_filter($events,
            static fn($event) => $event['id'] === $declaration['id']), 'type')));
        sort($effects);
        if ($kind === 'block-ttl') {
            $expected = $case === 'data_set' ? [] : ($case === 'data_get'
                ? ['layout-block-ttl-origin-unconfirmed'] : ['layout-block-ttl-applied']);
        } elseif ($kind === 'template') {
            $expected = $case === 'data_set' ? [] : (in_array($case, ['template_get', 'template_set', 'template_magic'], true)
                ? ['layout-template-origin-unconfirmed', 'layout-template-selected']
                : ['layout-template-executed', 'layout-template-selected']);
        } elseif ($case === 'data_direct') {
            $expected = ['layout-argument-applied', 'layout-argument-evaluated', 'layout-argument-field-access-unconfirmed'];
        } elseif ($case === 'data_get') {
            $expected = ['layout-argument-application-unconfirmed', 'layout-argument-evaluated'];
        } elseif ($case === 'data_set') {
            $expected = ['layout-argument-evaluated'];
        } elseif ($case === 'data_magic') {
            $expected = ['layout-argument-applied', 'layout-argument-evaluated', 'layout-argument-storage-unconfirmed'];
        } else {
            $expected = ['layout-argument-applied', 'layout-argument-evaluated'];
            if ($declaration['layout']['element'] !== 'nested') $expected[] = 'layout-argument-read';
        }
        if ($effects !== $expected) throw new RuntimeException('Property source evidence differs for ' . $case . '/' . $kind
            . ': ' . implode(', ', $effects));
    }
}
echo "Verified native storage lineage, independent template execution and unchanged property read counts.\n";
