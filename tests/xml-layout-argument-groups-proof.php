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
$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_argumentgroups.xml';
$source = file_get_contents(BP . '/' . $path);
$files = [['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
    'declarations' => LayoutManifest::declarations($path, $source)]];
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
$missing = (bool) array_intersect($argv, ['--missing-group-pre', '--missing-group-post', '--missing-parser']);
$depth = in_array('--group-depth', $argv, true);
$nodeLimit = in_array('--group-node-limit', $argv, true);
$groups = (new ReflectionProperty($collector, 'argumentGroups'))->getValue($collector);
if ($depth && !in_array('--without-collector', $argv, true)) {
    (new ReflectionProperty($groups, 'reading'))->setValue($groups, array_fill(0, 256, null));
}
if (!in_array('--without-collector', $argv, true)) foreach ($callbacks as [$class, $method, $pre, $post]) {
    $callback = $pre ?? $post;
    $groupCallback = $callback instanceof Closure && (new ReflectionFunction($callback))->getClosureThis() === $groups;
    if ($groupCallback && $method === 'getArguments') {
        if (in_array('--missing-group-pre', $argv, true)) $pre = null;
        if (in_array('--missing-group-post', $argv, true)) $post = null;
    }
    if ($groupCallback && $method === 'parseArguments' && in_array('--missing-parser', $argv, true)) $post = null;
    if (!LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot register argument group proof');
}
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
$area->load(Magento\Framework\App\Area::PART_CONFIG); $area->load(Magento\Framework\App\Area::PART_DESIGN);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$custom = in_array('--custom-selector', $argv, true);
if ($custom) {
    class MageLensArgumentGroupSelector extends Magento\Framework\View\Layout\Reader\Block
    {
        public static int $calls = 0;
        protected function getElementsByType(Magento\Framework\View\Layout\Element $element, $type)
        {
            self::$calls++;
            return parent::getElementsByType($element, $type);
        }
    }
    $copies = new WeakMap();
    OpenTelemetry\Instrumentation\hook(Magento\Framework\View\Layout\ReaderPool::class, 'prepareReader', null,
        static function ($pool) use ($copies): void {
            $property = new ReflectionProperty($pool, 'nodeReaders');
            $readers = $property->getValue($pool);
            foreach (['block', 'referenceBlock'] as $node) {
                $reader = $readers[$node] ?? null;
                if (!$reader instanceof Magento\Framework\View\Layout\Reader\Block || $reader instanceof MageLensArgumentGroupSelector) continue;
                if (!isset($copies[$reader])) {
                    $replacement = (new ReflectionClass(MageLensArgumentGroupSelector::class))->newInstanceWithoutConstructor();
                    foreach ((new ReflectionClass(Magento\Framework\View\Layout\Reader\Block::class))->getProperties() as $field) {
                        if (!$field->isStatic() && $field->isInitialized($reader)) $field->setValue($replacement, $field->getValue($reader));
                    }
                    $copies[$reader] = $replacement;
                }
                $readers[$node] = $copies[$reader];
            }
            $property->setValue($pool, $readers);
        });
}
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
$countPosition = array_search('--selector-calls', $argv, true);
$expectedCalls = $countPosition === false ? null : (int) ($argv[$countPosition + 1] ?? 0);
if ($custom && ($expectedCalls === null || MageLensArgumentGroupSelector::$calls !== $expectedCalls)) throw new RuntimeException('Native selector call count changed: ' . MageLensArgumentGroupSelector::$calls);
echo "Verified native block/reference first-group selection and absent later-group values.\n";
if (in_array('--without-collector', $argv, true)) exit;
if ($nodeLimit) {
    $xml = simplexml_load_string('<arguments>' . str_repeat('<argument/>', 32769) . '</arguments>');
    (new ReflectionMethod($groups, 'ignored'))->invoke($groups, $xml, ['area' => 'frontend', 'theme' => 'frontend/MageLens/proof']);
}
try { $state = $collector->finish(); }
catch (RuntimeException $error) {
    if ((!$missing && !$depth && !$nodeLimit) || !preg_match('/argument group/i', $error->getMessage())) throw $error;
    echo "Verified missing or unbounded argument-group evidence rejects publication after unchanged native output.\n";
    exit;
}
if ($missing || $depth || $nodeLimit) throw new RuntimeException('Missing or unbounded argument group observations were accepted');
$events = array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue());
if ($custom) {
    foreach ($files[0]['declarations'] as $item) {
        if ($item['layout']['kind'] !== 'argument-group') continue;
        $types = array_column(array_filter($events, static fn($event) => $event['id'] === $item['id']), 'type');
        if ($types !== ['layout-xml-ownership-revoked']) throw new RuntimeException('Custom group selector retained original source credit');
    }
    echo "Verified equal-output custom group selection retains no original group credit or extra selector calls.\n";
    exit;
}

foreach (['/layout/container/block', '/layout/referenceBlock'] as $parent) {
    foreach ([1 => 'layout-argument-group-selected', 2 => 'layout-argument-group-ignored'] as $position => $effect) {
        $node = $parent . '/arguments[' . $position . ']';
        $declarations = array_values(array_filter($files[0]['declarations'], static fn($item) => $item['node'] === $node));
        if (count($declarations) !== 1) throw new RuntimeException('Original group declaration is missing');
        $types = array_column(array_filter($events, static fn($event) => $event['id'] === $declarations[0]['id']), 'type');
        if (!in_array($effect, $types, true)) throw new RuntimeException('Original argument group lacks native selection evidence at ' . $node);
        if ($position === 2) foreach ($files[0]['declarations'] as $child) {
            if (!$child['supported'] || !str_starts_with($child['node'], $node . '/')) continue;
            $types = array_column(array_filter($events, static fn($event) => $event['id'] === $child['id']), 'type');
            if ($types !== ['layout-argument-group-ignored']) throw new RuntimeException('Ignored argument group retained independent descendant credit');
        }
    }
}
echo "Verified independent original argument-group selection and ignored-group outcomes.\n";
$evidencePath = array_search('--evidence-file', $argv, true);
if ($evidencePath !== false) {
    $encoded = json_encode(['files' => $files, 'layoutSources' => LayoutManifest::targets($files),
        'layoutHook' => $state[0], 'layoutSourceTrace' => $state[1], 'layoutLimitations' => $state[2],
        'events' => $events], JSON_THROW_ON_ERROR);
    if (file_put_contents($argv[$evidencePath + 1], $encoded) !== strlen($encoded)) throw new RuntimeException('Cannot write bounded argument group evidence');
}
