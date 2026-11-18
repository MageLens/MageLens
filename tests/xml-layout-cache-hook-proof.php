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

$mode = $argv[1] ?? 'native';
$nativeOnly = in_array('--native-only', $argv, true);
if ($mode === '--native-only') $mode = 'native';
if (!in_array($mode, ['native', 'equal', 'ui', 'missing-read', 'missing-loader', 'missing-pre', 'missing-post', 'depth'], true)) {
    throw new RuntimeException('Unknown block cache proof mode');
}
$files = [];
foreach ($mode === 'ui' ? ['component_index'] : ['cache_cold', 'cache_warm'] as $case) {
    $path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_' . $case . '.xml';
    $source = file_get_contents(BP . '/' . $path);
    $files[] = ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
        'declarations' => LayoutManifest::declarations($path, $source)];
}
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
foreach ($callbacks as [$class, $method, $pre, $post]) {
    if ($mode === 'missing-read' && $class === \Magento\Framework\App\CacheInterface::class && $method === 'load') continue;
    if ($mode === 'missing-loader' && $class === \Magento\Framework\Cache\LockGuardedCacheLoader::class) continue;
    if ($class === \Magento\Framework\View\Element\AbstractBlock::class && $method === '_loadCache') {
        if ($mode === 'missing-pre') $pre = null;
        if ($mode === 'missing-post') $post = null;
    }
    if (!\OpenTelemetry\Instrumentation\hook($class, $method, $pre, $post)) throw new RuntimeException('Cannot register cache proof hook');
}
if ($mode === 'depth') {
    (new ReflectionProperty(LayoutCoverage::class, 'loadingHtml'))->setValue($collector, array_fill(0, 256, []));
}
$objects = \Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(\Magento\Framework\App\State::class)->setAreaCode('frontend');
$objects->get(\Magento\Framework\App\AreaList::class)->getArea('frontend')->load(\Magento\Framework\App\Area::PART_CONFIG);
$cache = $objects->get(\Magento\Framework\App\Cache\StateInterface::class);
foreach (['layout', 'block_html', 'full_page'] as $type) $cache->setEnabled($type, false);
if ($mode === 'ui') {
    $roots = [];
    $renders = 0;
    if (!\OpenTelemetry\Instrumentation\hook(\Magento\Ui\Component\Wrapper\UiComponent::class, '_toHtml',
        static function ($block) use (&$roots, &$renders): void {
            if (in_array($block, $roots, true)) $renders++;
        }, null)) throw new RuntimeException('Cannot observe native UI rendering');
    $nonce = 'magelens_layout_ui_' . bin2hex(random_bytes(12));
    $cache->setEnabled('block_html', true);
    $key = null;
    $contents = [];
    $storage = $objects->get(\Magento\Framework\App\CacheInterface::class);
    try {
        foreach (['cold', 'warm'] as $case) {
            $fragment = $objects->create(\Magento\Framework\View\Result\Layout::class, ['isIsolated' => true]);
            $fragment->addHandle('coverageprobe_component_index');
            $block = $fragment->getLayout()->getBlock('magelens_layout_ui');
            $roots[] = $block;
            $block->setData('cache_lifetime', 600)->setData('cache_key', $nonce);
            $key = $block->getCacheKey();
            $contents[] = $block->toHtml();
        }
    } finally {
        if ($key !== null) $storage->remove($key);
        $cache->setEnabled('block_html', false);
    }
    if ($renders !== 1 || $contents[0] !== $contents[1] || !str_contains($contents[0], 'ui-content')) {
        throw new RuntimeException('Native UI block cache changed its render boundary or output (' . $renders . ', '
            . (int)($contents[0] === $contents[1]) . ', ' . (int)str_contains($contents[0], 'ui-content') . ')');
    }
    echo "Verified two native UI placements share HTML and execute their wrapper once.\n";
    if ($nativeOnly) exit;
    [, , $limits] = $collector->finish();
    $events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
    $placement = array_values(array_filter($files[0]['declarations'], static fn($item) =>
        $item['layout']['kind'] === 'ui-placement' && $item['layout']['element'] === 'magelens_layout_ui'))[0];
    $effects = array_column(array_filter($events, static fn($event) => $event['id'] === $placement['id']), 'hits', 'type');
    if (($effects['layout-ui-created'] ?? 0) !== 2 || ($effects['layout-ui-rendered'] ?? 0) !== 1
        || !in_array('block-html-cache-origin', $limits, true)) {
        throw new RuntimeException('Native cached UI placement lacks independent creation/render evidence or a cache origin limitation');
    }
    echo "Verified fresh UI construction and zero inferred cached wrapper execution.\n";
    exit;
}
$controller = $objects->create(\MageLens\Compatibility\Controller\Cache\Index::class);
$controller->replaceCachedHtml = $mode === 'equal';
$result = $controller->execute();
$response = $objects->get(\Magento\Framework\App\Response\Http::class);
$result->renderResult($response);
if (substr_count($response->getBody(), 'data-layout-block-cache>cold-value</span>') !== 2
    || \MageLens\Compatibility\Model\LayoutCacheCounter::$renders !== 1 || $cache->isEnabled('block_html')) {
    throw new RuntimeException('Native cold/warm block cache output or fixture cleanup changed');
}
echo "Verified two native layout builds share cached HTML and execute the cold template once.\n";
if ($nativeOnly) exit;
try {
    [, , $limits] = $collector->finish();
    if (str_starts_with($mode, 'missing-') || $mode === 'depth') throw new LogicException('Missing block cache observations were accepted');
} catch (RuntimeException $error) {
    $expected = ['missing-read' => 'Missing native block HTML cache read hook evidence',
        'missing-loader' => 'Missing native block HTML cache loader hook evidence',
        'missing-pre' => 'Unbalanced block HTML cache hook evidence',
        'missing-post' => 'Unbalanced block HTML cache hook evidence',
        'depth' => 'Layout block HTML cache nesting exceeded 256 calls'][$mode] ?? null;
    if (!$expected || !str_contains($error->getMessage(), $expected)) throw $error;
    echo "Verified native block cache publication guard for $mode.\n";
    exit;
}
$events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
if (!in_array('block-html-cache-origin', $limits, true)) throw new RuntimeException('Native cache origin limitation is absent');
$payload = json_encode($events, JSON_THROW_ON_ERROR);
foreach (['cold-value', 'warm-value', 'data-layout-block-cache'] as $value) {
    if (str_contains($payload, $value)) throw new RuntimeException('Runtime cache evidence retained response or argument values');
}
foreach ($files as $index => $file) {
    foreach ($file['declarations'] as $declaration) {
        $kind = $declaration['layout']['kind'];
        if (!in_array($kind, ['template', 'argument', 'block'], true)) continue;
        $effects = array_values(array_unique(array_column(array_filter($events,
            static fn($event) => $event['id'] === $declaration['id']), 'type')));
        sort($effects);
        if ($kind === 'template') {
            $expected = $index === 0 ? ['layout-template-executed', 'layout-template-selected']
                : ['layout-template-cache-unconfirmed', 'layout-template-selected'];
            if ($effects !== $expected) throw new RuntimeException('Cached HTML lacks an explicit original-template evidence boundary');
        }
        if ($kind === 'argument' && $declaration['layout']['element'] === 'value') {
            if (in_array('layout-argument-read', $effects, true) !== ($index === 0)) {
                throw new RuntimeException('Cached HTML incorrectly implies a fresh XML value read');
            }
        }
        if ($kind === 'block' && !in_array('layout-block-created', $effects, true)) {
            throw new RuntimeException('Warm block cache lost independent fresh construction evidence');
        }
    }
}
echo "Verified independent cold/warm XML construction, value reads and original template execution.\n";
