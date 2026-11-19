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

$mode = $argv[1] ?? 'native';
if (!in_array($mode, ['native', 'missing-api', 'missing-attribute', 'missing-label', 'missing-type', 'depth'], true)) throw new RuntimeException('Unknown metadata proof');
$files = [];
foreach (['Compatibility' => ['custom', 'equal', 'wireframe', 'untyped'], 'LayoutOverlay' => ['custom', 'equal']] as $module => $cases) {
    foreach ($cases as $case) {
        $path = 'app/code/MageLens/' . $module . '/view/frontend/layout/coverageprobe_metadata_' . $case . '.xml';
        $source = file_get_contents(BP . '/' . $path);
        $files[] = ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
            'declarations' => LayoutManifest::declarations($path, $source)];
    }
}
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
foreach ($callbacks as [$class, $method, $pre, $post]) {
    if ($mode === 'missing-api' && $method === 'getAllDesignAbstractions') continue;
    if ($mode === 'missing-attribute' && $class === Magento\Framework\Simplexml\Element::class && $method === 'getAttribute') continue;
    if (in_array($mode, ['missing-label', 'missing-type'], true)
        && $class === Magento\Framework\Simplexml\Element::class && $method === 'getAttribute') {
        $observe = $post;
        $missing = $mode === 'missing-label' ? 'label' : 'design_abstraction';
        $post = static function (...$arguments) use ($observe, $missing): void {
            if (($arguments[1][0] ?? null) !== $missing) $observe(...$arguments);
        };
    }
    if (!\MageLens\XmlCoverage\LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot register metadata hook proof');
}
if ($mode === 'depth') {
    $metadata = (new ReflectionProperty(LayoutCoverage::class, 'handleMetadata'))->getValue($collector);
    (new ReflectionProperty(MageLens\XmlCoverage\LayoutHandleMetadata::class, 'reading'))->setValue($metadata, array_fill(0, 256, []));
}
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
$area->load(Area::PART_CONFIG);
$area->load(Area::PART_DESIGN);
$objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled('layout', false);
$merge = $objects->create(Magento\Framework\View\Layout::class)->getUpdate();
$result = $merge->getAllDesignAbstractions();
foreach (['custom' => 'Registry custom label', 'equal' => 'Registry equal label', 'wireframe' => 'Registry wireframe label'] as $case => $label) {
    if (($result['coverageprobe_metadata_' . $case]['label'] ?? null) !== $label) throw new RuntimeException('Native metadata label changed');
}
if (isset($result['coverageprobe_metadata_untyped'])
    || !$merge->isCustomerDesignAbstraction($result['coverageprobe_metadata_custom'])
    || !$merge->isPageLayoutDesignAbstraction($result['coverageprobe_metadata_wireframe'])
    || !in_array('coverageprobe_metadata_untyped', $merge->getAvailableHandles(), true)) {
    throw new RuntimeException('Native metadata selection changed');
}
echo "Verified native metadata evaluation, equal-valued overlays, classification and untyped filtering.\n";
if (in_array('--native-only', $argv, true)) exit;
try {
    $collector->finish();
    if ($mode !== 'native') throw new LogicException('Missing metadata evidence was accepted');
} catch (RuntimeException $error) {
    $expected = ['missing-api' => 'Missing native handle metadata hook evidence',
        'missing-attribute' => 'Missing native handle metadata attribute hook evidence',
        'missing-label' => 'Missing native handle metadata attribute hook evidence',
        'missing-type' => 'Missing native handle metadata attribute hook evidence',
        'depth' => 'Handle metadata nesting exceeded 256 calls'][$mode] ?? null;
    if (!$expected || !str_contains($error->getMessage(), $expected)) throw $error;
    echo "Verified native metadata publication guard for $mode.\n";
    exit;
}
$events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
foreach ($files as $file) {
    foreach ($file['declarations'] as $item) {
        if (!in_array($item['layout']['attribute'], ['label', 'design_abstraction'], true)) continue;
        $kind = $item['layout']['attribute'] === 'label' ? 'label' : 'type';
        $actual = [];
        foreach ($events as $event) if ($event['id'] === $item['id']) $actual[$event['type']] = $event['hits'];
        $untyped = str_ends_with($file['path'], '_untyped.xml');
        $overridden = str_contains($file['path'], '/Compatibility/') && !str_ends_with($file['path'], '_wireframe.xml');
        $expected = $untyped ? [] : ['layout-handle-' . $kind . '-evaluated' => 1,
            ($overridden ? 'layout-handle-metadata-overridden' : 'layout-handle-metadata-returned') => 1];
        ksort($actual);
        ksort($expected);
        if ($actual !== $expected) throw new RuntimeException('Missing original handle metadata evidence for ' . $file['path'] . '/' . $kind);
    }
}
echo "Verified original metadata field evaluation and ordered result-map ownership.\n";
