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
use Magento\Framework\App\Area;

$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_renderfailure_after.xml';
$source = file_get_contents(BP . '/' . $path);
$declarations = LayoutManifest::declarations($path, $source);
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets([
    ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source), 'declarations' => $declarations],
]));
foreach ($callbacks as [$class, $method, $pre, $post]) {
    if (in_array('--without-collector', $argv, true)) continue;
    if (!\MageLens\XmlCoverage\LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot register native render proof hook');
}
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
$area->load(Area::PART_CONFIG);
$area->load(Area::PART_DESIGN);
$cache = $objects->get(Magento\Framework\App\Cache\StateInterface::class);
foreach (['layout', 'block_html', 'full_page'] as $type) $cache->setEnabled($type, false);
$result = $objects->get(MageLens\Compatibility\Controller\Renderfailure\Index::class)->execute();
$output = (new ReflectionProperty(Magento\Framework\Controller\Result\Raw::class, 'contents'))->getRawValue($result);
if (substr_count($output, '>verified</span>') !== 4 || str_contains($output, 'discarded output')) {
    throw new RuntimeException('Expected four native render outcomes and no discarded template HTML');
}
echo "Verified successful template execution followed by native block post-render failure.\n";
if (in_array('--without-collector', $argv, true)) exit;
$collector->finish();
$events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
foreach ($declarations as $declaration) {
    $kind = $declaration['layout']['kind'];
    if (!in_array($kind, ['block', 'template'], true)) continue;
    $actual = [];
    foreach ($events as $event) if ($event['id'] === $declaration['id']) $actual[$event['type']] = $event['hits'];
    $expected = $kind === 'block' ? ['layout-block-created' => 1, 'layout-block-render-failed' => 1]
        : ['layout-template-selected' => 1, 'layout-template-executed' => 1];
    ksort($actual); ksort($expected);
    if ($actual !== $expected) throw new RuntimeException('Independent native rendering evidence differs for ' . $kind);
}
echo "Verified completed template execution and failed block rendering retain independent source facts.\n";
