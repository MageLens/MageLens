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
use Magento\Framework\View\Layout\Condition\{ConditionFactory, VisibilityConditionInterface};

$mode = $argv[1] ?? 'native';
if (!in_array($mode, ['native', 'missing-factory', 'missing-key', 'missing-decision', 'missing-dynamic-key', 'missing-dynamic-decision', 'missing-magic', 'dynamic-limit'], true)) throw new RuntimeException('Unknown UI proof mode');
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
foreach ($callbacks as [$class, $method, $pre, $post]) {
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
    if ($mode !== 'native') throw new LogicException('Missing UI hook failure was accepted');
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
foreach (['layout-ui-group-applied', 'layout-condition-class-selected', 'layout-condition-name-applied',
    'layout-condition-argument-applied', 'layout-condition-allowed', 'layout-condition-denied', 'layout-ui-denied'] as $effect) {
    if (!in_array($effect, $effects, true)) throw new RuntimeException('Missing native UI effect ' . $effect);
}
echo "Verified native UI group, custom visibility, rule key and supplied argument boundaries.\n";
