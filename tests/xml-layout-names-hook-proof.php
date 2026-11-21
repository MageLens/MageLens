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
$files = [];
foreach (['base', 'overlay', 'containers', 'move'] as $handle) {
    $path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_names_' . $handle . '.xml';
    $source = file_get_contents(BP . '/' . $path);
    $files[] = ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
        'declarations' => LayoutManifest::declarations($path, $source)];
}
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
foreach ($callbacks as [$class, $method, $pre, $post]) {
    if (in_array('--without-collector', $argv, true)) continue;
    if (!\MageLens\XmlCoverage\LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot register numeric name hook');
}
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
$area->load(Magento\Framework\App\Area::PART_CONFIG); $area->load(Magento\Framework\App\Area::PART_DESIGN);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$objects->get(Magento\Framework\App\ViewInterface::class);
$request = $objects->get(Magento\Framework\App\RequestInterface::class);
$case = in_array($argv[1] ?? '', ['containers', 'move'], true) ? $argv[1] : 'blocks';
$request->setParam('case', $case);
$result = $objects->create(MageLens\Compatibility\Controller\Names\Index::class)->execute();
$response = $objects->create(Magento\Framework\App\Response\Http::class);
$result->renderResult($response);
if (!str_contains($response->getBody(), '<span data-layout-name-proof>verified</span>')) throw new RuntimeException('Native numeric name proof marker is missing');
$stale = $case === 'containers' && $objects->get(Magento\Framework\Module\ModuleListInterface::class)->has('MageOS_Seo') ? 1 : 0;
if (!str_contains($response->getBody(), '<span data-layout-name-stale-roots="' . $stale . '">verified</span>')) throw new RuntimeException('Native CLI shared-layout output retention differs');
if ($case !== 'containers') {
    $expected = $objects->get(Magento\Framework\App\State::class)->getMode() === Magento\Framework\App\State::MODE_DEVELOPER ? 'thrown' : 'logged';
    if (!str_contains($response->getBody(), 'data-layout-name-render-outcome="' . $expected . '"')) throw new RuntimeException('Native numeric exception outcome differs from the application mode');
}
echo "Verified native $case name structure and rendering.\n";
if (in_array('--without-collector', $argv, true)) exit;
$state = $collector->finish();
$evidencePath = array_search('--evidence-file', $argv, true);
if ($evidencePath !== false) {
    file_put_contents($argv[$evidencePath + 1], json_encode(['files' => $files,
        'layoutSources' => LayoutManifest::targets($files), 'layoutHook' => $state[0],
        'layoutSourceTrace' => $state[1], 'layoutLimitations' => $state[2],
        'events' => array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue())], JSON_THROW_ON_ERROR));
    echo "Wrote bounded original-source proof evidence without response bytes.\n";
    exit;
}
$events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
foreach ($files as $file) {
    foreach ($file['declarations'] as $item) {
        $kind = $item['layout']['kind'];
        $element = $item['layout']['element'];
        $types = array_values(array_unique(array_column(array_filter($events, static fn($event) => $event['id'] === $item['id']), 'type')));
        if ($kind === 'position-name' && $element === '0' && str_ends_with($file['path'], $case === 'containers' ? 'names_containers.xml' : 'names_base.xml')) {
            if ($types !== ['layout-position-name-defaulted']) throw new RuntimeException('Zero name was credited as an assigned identifier');
        }
        if ($kind !== 'block' || str_ends_with($file['path'], 'names_containers.xml') !== ($case === 'containers')) continue;
        $expectedRender = $element !== '124' || $case === 'move';
        if (in_array('layout-block-rendered', $types, true) !== $expectedRender) throw new RuntimeException('Missing original numeric/anonymous block render evidence for ' . $item['node']);
    }
}
echo "Verified independent original numeric/anonymous name and block effects.\n";
