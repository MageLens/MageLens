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
use Magento\Framework\View\Page\Config\Structure;

$files = [];
foreach (['base', 'falsy'] as $variant) {
    $path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_page_values_' . $variant . '.xml';
    $source = file_get_contents(BP . '/' . $path);
    $files[] = ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
        'declarations' => LayoutManifest::declarations($path, $source)];
}
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
$missing = array_values(array_intersect($argv, ['--missing-removal-pre', '--missing-removal-post', '--missing-removal-both']))[0] ?? null;
if (!in_array('--without-collector', $argv, true)) foreach ($callbacks as [$class, $method, $pre, $post]) {
    if ($class === Structure::class && $method === 'processRemoveElementAttributes') {
        if (in_array($missing, ['--missing-removal-pre', '--missing-removal-both'], true)) $pre = null;
        if (in_array($missing, ['--missing-removal-post', '--missing-removal-both'], true)) $post = null;
        if (!$pre && !$post) continue;
    }
    if (!LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot observe native falsy page configuration');
}
$removal = [];
if (!LayoutRuntimeHooks::register(Structure::class, 'processRemoveElementAttributes',
    static function ($structure) use (&$removal): void {
        $attributes = (new ReflectionProperty(Structure::class, 'elementAttributes'))->getRawValue($structure);
        if (($attributes['body']['data-layout-body-removed'] ?? null) === 'later') {
            $removal[] = [$attributes['html']['data-layout-html-removed'], $attributes['head']['data-layout-head-removed']];
        }
    }, static function ($structure) use (&$removal): void {
        if (count($removal) !== 1) return;
        $attributes = (new ReflectionProperty(Structure::class, 'elementAttributes'))->getRawValue($structure);
        $removal[] = [
            isset($attributes['html']['data-layout-html-removed']),
            isset($attributes['head']['data-layout-head-removed']),
            isset($attributes['body']['data-layout-body-removed']),
        ];
    })) throw new RuntimeException('Cannot observe native scheduled page attribute removal');
$assetRemoval = [];
if (!LayoutRuntimeHooks::register(Structure::class, 'processRemoveAssets',
    static function ($structure) use (&$assetRemoval): void {
        $assets = (new ReflectionProperty(Structure::class, 'assets'))->getRawValue($structure);
        $queue = (new ReflectionProperty(Structure::class, 'removeAssets'))->getRawValue($structure);
        if (($assets['']['rel'] ?? null) === 'preconnect') $assetRemoval[] = array_key_exists('', $queue);
    }, static function ($structure) use (&$assetRemoval): void {
        if (count($assetRemoval) !== 1) return;
        $assets = (new ReflectionProperty(Structure::class, 'assets'))->getRawValue($structure);
        $assetRemoval[] = array_key_exists('', $assets);
    })) throw new RuntimeException('Cannot observe native empty asset removal');
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
$area->load(Area::PART_CONFIG);
$area->load(Area::PART_DESIGN);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$objects->get(RequestInterface::class)->setParam('variant', 'page-values');
$page = $objects->get(MageLens\Compatibility\Controller\Handle\Index::class)->execute();
$response = $objects->create(Magento\Framework\App\Response\Http::class);
$page->renderResult($response);
$html = $response->getBody();
foreach (['<meta name="0" content="zero-key"/>', '<meta name="" content="empty-key"/>', 'data-layout-body-truthy="00"'] as $marker) {
    if (!str_contains($html, $marker)) throw new RuntimeException('Expected native fixture output: ' . $marker);
}
foreach (['data-layout-html-removed', 'data-layout-head-removed', 'data-layout-body-removed', 'data-layout-no-target',
    '<meta name="layout-empty"', '<meta name="layout-zero"', '<title>Displaced XML title</title>', '<title>0</title>', 'href="" rel="preconnect"'] as $marker) {
    if (str_contains($html, $marker)) throw new RuntimeException('Unexpected native fixture output: ' . $marker);
}
if ($removal !== [['original', 'original'], [false, false, false]]) throw new RuntimeException('Native page attribute removal queue changed');
if ($assetRemoval !== [true, false]) throw new RuntimeException('Native empty asset removal did not remove the queued key');
foreach ($files as $file) if (hash_file('sha256', BP . '/' . $file['path']) !== $file['sourceHash']) {
    throw new RuntimeException('Native falsy fixture changed original XML');
}
echo "Verified native zero/empty metadata, title suppression, attribute removal and empty asset removal.\n";
if (in_array('--without-collector', $argv, true)) exit;
if ($missing) {
    try {
        $collector->finish();
    } catch (RuntimeException $error) {
        if (!str_contains($error->getMessage(), 'Layout runtime hook callback failed')) throw $error;
        echo "Missing removal observation rejected publication after unchanged native output.\n";
        exit;
    }
    throw new RuntimeException('Incomplete page attribute removal hooks were accepted');
}
$collector->finish();
$events = array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue());
$expected = [
    '/page/html/attribute' => 'layout-page-attribute-removed',
    '/page/head/title' => 'layout-title-empty-ignored',
    '/page/head/meta[1]' => 'layout-metadata-empty-suppressed',
    '/page/head/meta[2]' => 'layout-metadata-empty-suppressed',
    '/page/head/meta[3]' => 'layout-metadata-rendered',
    '/page/head/meta[4]' => 'layout-metadata-rendered',
    '/page/head/attribute[1]' => 'layout-page-attribute-removed',
    '/page/head/attribute[2]' => 'layout-page-attribute-removal-target-missing',
    '/page/head/remove' => 'layout-asset-removed',
    '/page/head/remove/@src' => 'layout-asset-removed',
    '/page/body/attribute[1]' => 'layout-page-attribute-removed',
    '/page/body/attribute[2]' => 'layout-page-attribute-removed-before-output',
    '/page/body/attribute[3]' => 'layout-page-attribute-rendered',
];
foreach ($files[1]['declarations'] as $declaration) {
    if (!isset($expected[$declaration['node']])) continue;
    $actual = array_values(array_unique(array_column(array_filter($events, static fn($row) => $row['id'] === $declaration['id']), 'type')));
    if ($actual !== [$expected[$declaration['node']]]) {
        throw new RuntimeException('Falsy page effect differs at ' . $declaration['node'] . ': ' . implode(', ', $actual));
    }
    unset($expected[$declaration['node']]);
}
if ($expected) throw new RuntimeException('Native falsy declaration inventory changed');
echo "Verified precise original page configuration outcomes.\n";
