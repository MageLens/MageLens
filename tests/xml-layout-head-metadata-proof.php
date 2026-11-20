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
use Magento\Framework\App\Area;
use Magento\Framework\App\RequestInterface;

$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_page_metadata.xml';
$source = file_get_contents(BP . '/' . $path);
$file = ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
    'declarations' => LayoutManifest::declarations($path, $source)];
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets([$file]));
$nativeOnly = in_array('--without-collector', $argv, true);
if (!$nativeOnly) foreach ($callbacks as [$class, $method, $pre, $post]) {
    if (!LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot observe native metadata');
}
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
$area->load(Area::PART_CONFIG);
$area->load(Area::PART_DESIGN);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$objects->get(RequestInterface::class)->setParam('variant', 'page-metadata');
$page = $objects->get(MageLens\Compatibility\Controller\Handle\Index::class)->execute();
$programmatic = in_array('--programmatic', $argv, true);
if ($programmatic) $page->getConfig()->setKeywords('layout keyword proof');
$response = $objects->create(Magento\Framework\App\Response\Http::class);
$page->renderResult($response);
$html = $response->getBody();
foreach ([
    '<meta charset="UTF-8"/>',
    '<meta http-equiv="Content-Type" content="text/x-magelens; charset=UTF-8"/>',
    '<meta name="keywords" content="layout keyword proof"/>',
    '<meta name="title" content="Metadata title fallback"/>',
    '<meta property="og:layout-fixture" content="property metadata"/>',
    '<meta http-equiv="X-UA-Compatible" content="IE=edge"/>',
    ' ="layout-unnamed-html"', ' ="layout-unnamed-head"', '0="layout-zero-attribute"',
] as $marker) if (!str_contains($html, $marker)) throw new RuntimeException('Missing native metadata marker: ' . $marker);
foreach (['<meta name="media_type"', 'ignored attribute text'] as $marker) {
    if (str_contains($html, $marker)) throw new RuntimeException('Unexpected native metadata marker: ' . $marker);
}
if (hash_file('sha256', BP . '/' . $path) !== $file['sourceHash']) throw new RuntimeException('Native metadata fixture changed original XML');
echo "Verified native derived content type, title fallback, special tags and empty attribute names.\n";
if ($nativeOnly) exit;
$collector->finish();
$events = array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue());
$keywords = $programmatic ? 'layout-metadata-replaced' : 'layout-metadata-rendered';
$expected = [
    '/page/html/attribute' => ['layout-page-attribute-rendered'],
    '/page/head/attribute' => ['layout-page-attribute-rendered'],
    '/page/body/attribute/@name' => ['layout-page-attribute-rendered'],
    '/page/head/meta[1]/@content' => ['layout-metadata-content-type-input', 'layout-metadata-rendered'],
    '/page/head/meta[2]/@content' => ['layout-metadata-content-type-derived'],
    '/page/head/meta[3]/@content' => ['layout-metadata-content-type-input', 'layout-metadata-template-skipped'],
    '/page/head/meta[4]/@content' => [$keywords],
    '/page/head/meta[5]/@name' => ['layout-metadata-key-emitted'],
    '/page/head/meta[5]/@content' => ['layout-metadata-content-fallback'],
    '/page/head/meta[6]/@content' => ['layout-metadata-rendered'],
    '/page/head/meta[7]/@content' => ['layout-metadata-rendered'],
];
foreach ($file['declarations'] as $declaration) {
    $node = $declaration['node'];
    if (!isset($expected[$node])) continue;
    $actual = array_values(array_unique(array_column(array_filter($events, static fn($row) => $row['id'] === $declaration['id']), 'type')));
    sort($actual);
    if ($actual !== $expected[$node]) throw new RuntimeException('Metadata effect differs at ' . $node . ': ' . implode(', ', $actual));
    unset($expected[$node]);
}
if ($expected) throw new RuntimeException('Native metadata inventory changed');
echo "Verified original key, value, derived input and fallback outcomes.\n";
