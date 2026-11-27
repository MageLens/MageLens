<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
require '/var/www/html/app/bootstrap.php';
$hooks = dirname(getenv('MAGELENS_XML_HOOKS') ?: (require __DIR__ . '/project-root.php') . '/docker/php/xml-hooks.php');
require $hooks . '/xml-hooks.php';
require $hooks . '/xml-layout-manifest.php';
use MageLens\XmlCoverage\{LayoutCoverage, LayoutManifest, LayoutRuntimeHooks, Recorder};
$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_magicactions.xml';
$source = file_get_contents(BP . '/' . $path);
$files = [['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
    'declarations' => LayoutManifest::declarations($path, $source)]];
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
if (!in_array('--without-collector', $argv, true)) foreach ($callbacks as [$class, $method, $pre, $post]) {
    if (!LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot register magic action proof');
}
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
$area->load(Magento\Framework\App\Area::PART_CONFIG); $area->load(Magento\Framework\App\Area::PART_DESIGN);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$objects->get(Magento\Framework\App\ViewInterface::class);
$result = $objects->create(MageLens\Compatibility\Controller\Magicactions\Index::class)->execute();
$response = $objects->create(Magento\Framework\App\Response\Http::class);
$result->renderResult($response);
if (!str_contains($response->getBody(), '<span data-layout-magic-action-proof>verified</span>')) throw new RuntimeException('Native magic action proof marker is missing');
echo "Verified native empty/zero magic actions, denied guard and unrendered action target.\n";
if (in_array('--without-collector', $argv, true)) exit;
$state = $collector->finish();
$events = array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue());
$evidencePath = array_search('--evidence-file', $argv, true);
if ($evidencePath !== false) {
    file_put_contents($argv[$evidencePath + 1], json_encode(['files' => $files,
        'layoutSources' => LayoutManifest::targets($files), 'layoutHook' => $state[0],
        'layoutSourceTrace' => $state[1], 'layoutLimitations' => $state[2], 'events' => $events], JSON_THROW_ON_ERROR));
    echo "Wrote bounded original-source proof evidence without response bytes.\n";
    exit;
}
foreach ($files[0]['declarations'] as $block) {
    if ($block['layout']['kind'] !== 'block') continue;
    $node = $block['node'] . '/action';
    $expected = !str_ends_with($block['layout']['element'], '.denied');
    foreach (['action' => $node, 'action-method' => $node . '/@method'] as $kind => $location) {
        $matching = array_values(array_filter($files[0]['declarations'], static fn(array $item): bool =>
            $item['node'] === $location && $item['layout']['kind'] === $kind && $item['supported']));
        if (count($matching) !== 1) throw new RuntimeException('Missing original magic action/method inventory');
        $executed = array_filter($events, static fn(array $event): bool => $event['id'] === $matching[0]['id']
            && $event['type'] === 'layout-action-executed' && $event['hits'] > 0);
        if ((bool) $executed !== $expected) throw new RuntimeException('Original magic action execution differs from its native effect');
    }
}
echo "Verified independent original magic action/method execution evidence.\n";
