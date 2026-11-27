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
use Magento\Framework\View\Element\BlockFactory;
use Magento\Framework\View\Layout\Generator\Block as BlockGenerator;

$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_packagemutation_native.xml';
$source = file_get_contents(BP . '/' . $path);
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets([
    ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
        'declarations' => LayoutManifest::declarations($path, $source)],
]));
if (in_array('--receiver-limit', $argv, true) && !in_array('--without-collector', $argv, true)) {
    OpenTelemetry\Instrumentation\hook(Magento\Framework\ObjectManagerInterface::class, 'create',
        static function () use ($collector): void {
            static $injected = false;
            $property = new ReflectionProperty($collector, 'generating');
            $frames = $property->getValue($collector);
            $index = array_key_last($frames);
            if ($injected || $index === null) return;
            $injected = true;
            for ($count = 0; $count < 128; $count++) {
                $receiver = new stdClass();
                $frames[$index]['managerFactories'][spl_object_id($receiver)] = ['object' => $receiver, 'count' => 1];
            }
            $property->setValue($collector, $frames);
        });
}
if (!in_array('--without-collector', $argv, true)) foreach ($callbacks as [$class, $method, $pre, $post]) {
    if (!LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot observe factory fixture');
}
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
foreach ([Magento\Framework\App\Area::PART_CONFIG, Magento\Framework\App\Area::PART_DESIGN] as $part) $area->load($part);
foreach (['layout', 'block_html', 'full_page'] as $type) {
    $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
}
$objects->get(Magento\Framework\App\ViewInterface::class);
$page = $objects->get(Magento\Framework\View\Result\PageFactory::class)->create(true, ['isIsolated' => true]);
$page->addHandle('coverageprobe_packagemutation_native');
$layout = $page->getLayout();
$pool = (new ReflectionProperty($layout, 'generatorPool'))->getValue($layout);
$generator = $pool->getGenerator('block');
$initializations = 0;
$nativeBoundary = false;
if (in_array('--lazy-generator', $argv, true)) {
    $type = new ReflectionClass(BlockGenerator::class);
    $type->initializeLazyObject($generator);
    $dependencies = [];
    foreach ($type->getConstructor()->getParameters() as $parameter) {
        $dependencies[] = (new ReflectionProperty(BlockGenerator::class, $parameter->getName()))->getRawValue($generator);
    }
    $generator = $type->newLazyGhost(
        static function ($generator) use ($dependencies, &$initializations, &$nativeBoundary): void {
            $initializations++;
            $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 2)[1] ?? [];
            $nativeBoundary = ($caller['class'] ?? null) === BlockGenerator::class
                && ($caller['function'] ?? null) === 'getBlockInstance';
            $generator->__construct(...$dependencies);
        });
    $property = new ReflectionProperty($pool, 'generators');
    $generators = $property->getRawValue($pool);
    $generators['block'] = $generator;
    $property->setValue($pool, $generators);
} elseif (in_array('--lazy-manager', $argv, true)) {
    $managerClass = get_class($objects);
    $objectFactory = (new ReflectionProperty($objects, '_factory'))->getRawValue($objects);
    $config = (new ReflectionProperty($objects, '_config'))->getRawValue($objects);
    $shared = (new ReflectionProperty($objects, '_sharedInstances'))->getRawValue($objects);
    $lazyManager = (new ReflectionClass($managerClass))->newLazyGhost(
        static function ($manager) use ($objectFactory, $config, $shared, &$initializations, &$nativeBoundary): void {
            $initializations++;
            $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 2)[1] ?? [];
            $nativeBoundary = ($caller['class'] ?? null) === Magento\Framework\ObjectManager\ObjectManager::class
                && ($caller['function'] ?? null) === 'create';
            $manager->__construct($objectFactory, $config, $shared);
        });
    $factory = new BlockFactory($lazyManager);
} else {
    $factory = (new ReflectionClass(BlockFactory::class))->newLazyGhost(
        static function ($factory) use ($objects, &$initializations, &$nativeBoundary): void {
            $initializations++;
            $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 2)[1] ?? [];
            $nativeBoundary = ($caller['class'] ?? null) === BlockFactory::class && ($caller['function'] ?? null) === 'createBlock';
            $factory->__construct($objects);
        });
}
if (!in_array('--lazy-generator', $argv, true)) {
    (new ReflectionProperty(BlockGenerator::class, 'blockFactory'))->setValue($generator, $factory);
}
$block = $layout->getBlock('magelens.layout.package.native');
if (!$block || $block->getData('late') !== 'xml-value'
    || !str_contains($block->toHtml(), 'data-layout-mutation>xml-value</span>')) {
    throw new RuntimeException('Native lazy factory fixture output changed');
}
if ($initializations !== 1 || !$nativeBoundary) {
    throw new RuntimeException('Layout collection changed the native factory initialization boundary');
}
echo "Verified unchanged native factory initialization and rendered values.\n";
if (in_array('--without-collector', $argv, true)) exit;
try { $collector->finish(); }
catch (RuntimeException $error) {
    if (!in_array('--receiver-limit', $argv, true)
        || !str_contains($error->getMessage(), 'Layout factory object-manager observations exceeded 128 receivers')) throw $error;
    echo "Verified bounded factory receiver evidence rejects publication after unchanged output.\n";
    exit;
}
if (in_array('--receiver-limit', $argv, true)) throw new RuntimeException('Unbounded factory receiver evidence was accepted');
$declarations = LayoutManifest::declarations($path, $source);
$class = array_values(array_filter($declarations, static fn($item) => $item['layout']['kind'] === 'block-class'))[0];
$events = array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue());
$effects = array_column(array_filter($events, static fn($event) => $event['id'] === $class['id']), 'type');
$expected = in_array('--lazy-manager', $argv, true) ? 'layout-block-class-storage-unconfirmed' : 'layout-block-class-applied';
if ($effects !== [$expected]) throw new RuntimeException('Lazy factory dependency source evidence changed');
echo "Verified original class evidence and explicit unknown lazy-manager provenance independently of initialization.\n";
