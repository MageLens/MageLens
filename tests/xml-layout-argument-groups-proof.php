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

use MageLens\XmlCoverage\{LayoutCoverage, LayoutManifest, LayoutRuntimeHooks, Recorder};
$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_argumentgroups.xml';
$source = file_get_contents(BP . '/' . $path);
$files = [['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
    'declarations' => LayoutManifest::declarations($path, $source)]];
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
if (!in_array('--without-collector', $argv, true)) foreach ($callbacks as [$class, $method, $pre, $post]) {
    if (!LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot register argument group proof');
}
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
$area->load(Magento\Framework\App\Area::PART_CONFIG); $area->load(Magento\Framework\App\Area::PART_DESIGN);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$objects->get(Magento\Framework\App\ViewInterface::class);
$result = $objects->create(MageLens\Compatibility\Controller\Argumentgroups\Index::class)->execute();
$response = $objects->create(Magento\Framework\App\Response\Http::class);
$result->renderResult($response);
$html = $response->getBody();
if (!str_contains($html, 'data-layout-argument-group="block">first-group</span>')
    || !str_contains($html, 'data-layout-argument-group="reference">first-reference-group</span>')
    || str_contains($html, 'second-group') || str_contains($html, 'second-reference-group')) {
    throw new RuntimeException('Native first argument group selection changed');
}
echo "Verified native block/reference first-group selection and absent later-group values.\n";
if (in_array('--without-collector', $argv, true)) exit;
$collector->finish();
$events = array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue());
foreach (['/layout/container/block', '/layout/referenceBlock'] as $parent) {
    foreach ([1 => 'layout-argument-group-selected', 2 => 'layout-argument-group-ignored'] as $position => $effect) {
        $node = $parent . '/arguments[' . $position . ']';
        $declarations = array_values(array_filter($files[0]['declarations'], static fn($item) => $item['node'] === $node));
        if (count($declarations) !== 1) throw new RuntimeException('Original group declaration is missing');
        $types = array_column(array_filter($events, static fn($event) => $event['id'] === $declarations[0]['id']), 'type');
        if (!in_array($effect, $types, true)) throw new RuntimeException('Original argument group lacks native selection evidence at ' . $node);
    }
}
echo "Verified independent original argument-group selection and ignored-group outcomes.\n";
