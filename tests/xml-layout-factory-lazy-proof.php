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

use MageLens\XmlCoverage\{LayoutCoverage, LayoutManifest, LayoutRuntimeHooks};
use Magento\Framework\View\Element\BlockFactory;
use Magento\Framework\View\Layout\Generator\Block as BlockGenerator;

$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_packagemutation_native.xml';
$source = file_get_contents(BP . '/' . $path);
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets([
    ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
        'declarations' => LayoutManifest::declarations($path, $source)],
]));
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
if (in_array('--lazy-manager', $argv, true)) {
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
(new ReflectionProperty(BlockGenerator::class, 'blockFactory'))->setValue($generator, $factory);
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
$collector->finish();
