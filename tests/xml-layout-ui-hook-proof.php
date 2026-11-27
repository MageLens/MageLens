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
use Magento\Framework\View\Layout\Condition\{ConditionFactory, VisibilityConditionInterface};
use Magento\Framework\View\Layout\Argument\Parser;
use Magento\Framework\View\Layout\Reader\Visibility\Condition as ConditionReader;

$mode = $argv[1] ?? 'native';
if (!in_array($mode, ['native', 'missing-factory', 'missing-key', 'missing-decision', 'missing-dynamic-key', 'missing-dynamic-decision', 'missing-magic', 'dynamic-limit', 'custom-parser'], true)) throw new RuntimeException('Unknown UI proof mode');
$files = [];
foreach (glob(BP . '/app/code/MageLens/Compatibility/view/frontend/layout/*.xml') as $file) {
    $path = substr($file, strlen(BP) + 1);
    $source = file_get_contents($file);
    $files[] = ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
        'declarations' => LayoutManifest::declarations($path, $source)];
}
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
$structure = (new ReflectionProperty(LayoutCoverage::class, 'structureCoverage'))->getValue($collector);
$registration = match ($mode) {
    'missing-dynamic-key' => ['MageLens\\Compatibility\\Model\\LayoutVisibilityDuck' => ['getName' => true]],
    'missing-dynamic-decision' => ['MageLens\\Compatibility\\Model\\LayoutVisibilityDuck' => ['isVisible' => true]],
    'missing-magic' => ['MageLens\\Compatibility\\Model\\LayoutVisibilityMagic' => ['__call' => true]],
    'dynamic-limit' => array_fill_keys(array_map(static fn($index) => 'fixture-' . $index, range(1, 1024)), []),
    default => [],
};
(new ReflectionProperty(get_class($structure), 'conditionHooks'))->setValue($structure, $registration);
$nativeOnly = in_array('--without-collector', $argv, true);
$customParserCalls = 0;
if ($mode === 'custom-parser' && !LayoutRuntimeHooks::register(ConditionReader::class, '__construct', null,
    static function ($reader) use (&$customParserCalls): void {
        $parser = new class(static function () use (&$customParserCalls): void { $customParserCalls++; }) extends Parser {
            public function __construct(private Closure $observed)
            {
            }

            public function parse(DOMNode $argumentNode)
            {
                ($this->observed)();
                return parent::parse($argumentNode);
            }
        };
        (new ReflectionProperty(ConditionReader::class, 'argumentParser'))->setRawValue($reader, $parser);
    })) throw new RuntimeException('Cannot install disposable visibility parser');
if (!$nativeOnly) foreach ($callbacks as [$class, $method, $pre, $post]) {
    if (($mode === 'missing-factory' && $class === ConditionFactory::class && $method === 'create')
        || ($mode === 'missing-key' && $class === VisibilityConditionInterface::class && $method === 'getName')
        || ($mode === 'missing-decision' && $class === VisibilityConditionInterface::class && $method === 'isVisible')) continue;
    if (!\MageLens\XmlCoverage\LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot register UI proof hook');
}
$manager = \Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$manager->get(\Magento\Framework\App\State::class)->setAreaCode('frontend');
$manager->get(\Magento\Framework\App\AreaList::class)->getArea('frontend')->load(\Magento\Framework\App\Area::PART_CONFIG);
$manager->get(\Magento\Framework\App\AreaList::class)->getArea('frontend')->load(\Magento\Framework\App\Area::PART_DESIGN);
$cacheState = $manager->get(\Magento\Framework\App\Cache\StateInterface::class);
foreach (['layout', 'block_html', 'full_page'] as $type) $cacheState->setEnabled($type, false);
$fragment = $manager->create(\Magento\Framework\View\Result\Layout::class, ['isIsolated' => true]);
$fragment->addHandle('coverageprobe_component_index');
$layout = $fragment->getLayout();
if (!$layout->getBlock('magelens_layout_ui') instanceof \Magento\Ui\Component\Wrapper\UiComponent
    || $layout->hasElement('magelens_layout_ui_denied')) throw new RuntimeException('Native UI fixture mismatch');
if ($mode === 'custom-parser' && $customParserCalls !== 14) throw new RuntimeException('Native visibility parser did not visit each top-level operand');
if ($nativeOnly) {
    echo "Verified native visibility outcomes before collector installation.\n";
    exit;
}
try {
    [, , $limits] = $collector->finish();
    if ($mode === 'dynamic-limit' && in_array('layout-condition-hook-limit', $limits, true)) {
        $events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
        $limited = array_column(array_filter($events, static fn($event) => $event['type'] === 'layout-condition-unconfirmed'), 'id');
        if (!$limited) throw new RuntimeException('Visibility limit produced no explicit unconfirmed decisions');
        foreach ($events as $event) {
            if (in_array($event['id'] ?? null, $limited, true)
                && in_array($event['type'], ['layout-condition-allowed', 'layout-condition-denied'], true)) {
                throw new RuntimeException('Limited visibility rule received an unverified decision');
            }
        }
        echo "Verified bounded native visibility hook registration preserves component construction.\n";
        exit;
    }
    if (!in_array($mode, ['native', 'custom-parser'], true)) throw new LogicException('Missing UI hook failure was accepted');
} catch (RuntimeException $error) {
    $expected = ['missing-factory' => 'Missing native visibility factory', 'missing-key' => 'Missing native visibility key',
        'missing-decision' => 'Missing native visibility decision', 'missing-dynamic-key' => 'Missing native visibility key',
        'missing-dynamic-decision' => 'Missing native visibility decision', 'missing-magic' => 'Missing native visibility key'][$mode] ?? null;
    if (!$expected || !str_contains($error->getMessage(), $expected)) throw $error;
    echo "Verified native UI integrity failure for $mode.\n";
    exit;
}
$events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
$effects = array_column($events, 'type');
if ($mode === 'custom-parser') {
    if (!in_array('mutable-layout-xml', $limits, true)) throw new RuntimeException('Missing mutable visibility source limitation');
    $revoked = array_fill_keys(array_column(array_filter($events, static fn($event) => $event['type'] === 'layout-xml-ownership-revoked'), 'id'), true);
    foreach ($files as $file) {
        if (!str_ends_with($file['path'], '/coverageprobe_component_index.xml')) continue;
        foreach ($file['declarations'] as $row) {
            if (!$row['supported'] || !str_contains($row['node'], '/visibilityCondition')) continue;
            if (!isset($revoked[$row['id']])) throw new RuntimeException('Custom visibility parser retained original ownership');
        }
    }
    foreach (['layout-condition-argument-applied', 'layout-argument-type-evaluated', 'layout-argument-group-selected'] as $type) {
        if (in_array($type, $effects, true)) throw new RuntimeException('Custom visibility parser received an original XML hit');
    }
    echo "Verified equal-output custom visibility parsing retains native UI and revokes original argument provenance.\n";
    exit;
}
$required = ['layout-ui-group-applied', 'layout-condition-class-selected', 'layout-condition-name-applied',
    'layout-condition-allowed', 'layout-condition-denied', 'layout-ui-denied', 'layout-condition-argument-applied'];
foreach ($required as $effect) {
    if (!in_array($effect, $effects, true)) throw new RuntimeException('Missing native UI effect ' . $effect);
}
$nativeEffects = [];
foreach ($events as $record) $nativeEffects[$record['id']][$record['type']] = true;
foreach ($files as $file) {
    if (!str_ends_with($file['path'], '/coverageprobe_component_index.xml')) continue;
    foreach ($file['declarations'] as $row) {
        $node = $row['node'];
        if (!str_contains($node, '/visibilityCondition') || !str_contains($node, '/arguments')) continue;
        $expected = match ($row['layout']['kind']) {
            'argument-group' => ['layout-argument-group-selected'],
            'argument-type' => ['layout-argument-type-evaluated'],
            'visibility-argument', 'visibility-argument-name' => [preg_match('~/visibilityCondition\[[234]\]/arguments~', $node)
                    ? 'layout-condition-argument-unconsumed' : 'layout-condition-argument-applied'],
            default => null,
        };
        if ($expected !== null && array_keys($nativeEffects[$row['id']] ?? []) !== $expected) {
            throw new RuntimeException('Native visibility evidence differs at ' . $node);
        }
    }
}
echo "Verified native visibility group selection, type dispatch and original argument name delivery.\n";
