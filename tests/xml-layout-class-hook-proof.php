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
require __DIR__ . '/xml-layout-native-interceptor.php';

use MageLens\XmlCoverage\{LayoutCoverage, LayoutManifest, Recorder};
use Magento\Framework\View\Layout\Generator\Block as BlockGenerator;
use Magento\Framework\View\Element\BlockFactory;

$mode = $argv[1] ?? 'native';
if (!in_array($mode, ['native', 'native-production', 'fallback', 'compiled-fallback', 'factory', 'object-manager', 'manager-restore',
    'factory-fallback', 'factory-plugin', 'compiled-factory-plugin', 'generator-plugin', 'compiled-generator-plugin',
    'around', 'compiled-around', 'no-parent', 'empty-class', 'missing-factory', 'missing-creation', 'missing-wrapper',
    'missing-creation-pre', 'missing-creation-post', 'missing-manager', 'missing-manager-pre', 'missing-manager-post',
    'manager-depth', 'registration-limit', 'missing-registration', 'missing-render-path', 'missing-block-process'], true)) {
    throw new RuntimeException('Unknown class proof mode');
}
$handle = $mode === 'empty-class' ? 'coverageprobe_classdefault_index' : 'coverageprobe_packagemutation_native';
$path = 'app/code/MageLens/Compatibility/view/frontend/layout/' . $handle . '.xml';
if ($mode === 'empty-class' && (!is_file(BP . '/' . $path)
    || hash_file('sha256', BP . '/' . $path) !== hash_file('sha256', __DIR__ . '/invalid-layout/class-empty.xml'))) {
    throw new RuntimeException('Install the disposable invalid class fixture before this production proof');
}
$source = file_get_contents(BP . '/' . $path);
$declarations = LayoutManifest::declarations($path, $source);
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets([
    ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source), 'declarations' => $declarations],
]));
if (in_array($mode, ['missing-wrapper', 'registration-limit'], true)) {
    $ownership = (new ReflectionProperty(LayoutCoverage::class, 'ownership'))->getValue($collector);
    $watched = $mode === 'missing-wrapper' ? [BlockGenerator::class . '\\Interceptor::createBlock' => true]
        : array_fill_keys(array_map(static fn($index) => 'fixture' . $index, range(0, 1023)), true);
    (new ReflectionProperty(\MageLens\XmlCoverage\LayoutXmlOwnership::class, 'watched'))->setValue($ownership, $watched);
}
if ($mode === 'manager-depth') {
    (new ReflectionProperty(LayoutCoverage::class, 'blockObjectCreations'))->setValue($collector, array_fill(0, 256, null));
}
foreach ($callbacks as [$class, $method, $pre, $post]) {
    if ($mode === 'missing-registration' && $class === \Magento\Framework\View\Layout::class && $method === 'setBlock') continue;
    if ($mode === 'missing-render-path' && $class === \Magento\Framework\View\Layout::class && $method === '_renderBlock') continue;
    if ($mode === 'missing-block-process' && $class === BlockGenerator::class && $method === 'process'
        && $pre instanceof Closure && (new ReflectionFunction($pre))->getClosureThis() instanceof \MageLens\XmlCoverage\LayoutBlockRendering) continue;
    if ($class === \Magento\Framework\ObjectManagerInterface::class && $method === 'create') {
        if ($mode === 'missing-manager') continue;
        if ($mode === 'missing-manager-pre') $pre = null;
        if ($mode === 'missing-manager-post') $post = null;
    }
    if ($mode === 'missing-creation' && $class === BlockGenerator::class && $method === 'createBlock') continue;
    if ($class === BlockGenerator::class && $method === 'createBlock') {
        if ($mode === 'missing-creation-pre') $pre = null;
        if ($mode === 'missing-creation-post') $post = null;
    }
    if ($mode === 'missing-factory' && $class === BlockFactory::class && $method === 'createBlock') continue;
    if ($mode === 'missing-wrapper' && $class === BlockGenerator::class && $method === 'createBlock') {
        $nativePre = $pre;
        $nativePost = $post;
        $pre = static function (...$arguments) use ($nativePre): void {
            if ($arguments[2] !== get_class($arguments[0])) $nativePre(...$arguments);
        };
        $post = static function (...$arguments) use ($nativePost): void {
            if ($arguments[4] !== get_class($arguments[0])) $nativePost(...$arguments);
        };
    }
    if (!\MageLens\XmlCoverage\LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot register class proof hook');
}
$parameters = $_SERVER;
if (in_array($mode, ['empty-class', 'native-production'], true)) $parameters[\Magento\Framework\App\State::PARAM_MODE] = \Magento\Framework\App\State::MODE_PRODUCTION;
$manager = \Magento\Framework\App\Bootstrap::create(BP, $parameters)->getObjectManager();
if (in_array($mode, ['empty-class', 'native-production'], true) && $manager->get(\Magento\Framework\App\State::class)->getMode() !== 'production') {
    throw new RuntimeException('Invalid class fixture requires the native production validation path');
}
$manager->get(\Magento\Framework\App\State::class)->setAreaCode('frontend');
$manager->get(\Magento\Framework\App\AreaList::class)->getArea('frontend')->load(\Magento\Framework\App\Area::PART_CONFIG);
$manager->get(\Magento\Framework\App\AreaList::class)->getArea('frontend')->load(\Magento\Framework\App\Area::PART_DESIGN);
$cacheState = $manager->get(\Magento\Framework\App\Cache\StateInterface::class);
foreach (['layout', 'block_html', 'full_page'] as $type) $cacheState->setEnabled($type, false);
$plugin = match ($mode) {
    'generator-plugin', 'compiled-generator-plugin' => \MageLens\Compatibility\Model\LayoutGeneratorClass::class,
    'around', 'compiled-around' => \MageLens\Compatibility\Model\LayoutGeneratorAround::class,
    'no-parent' => \MageLens\Compatibility\Model\LayoutGeneratorReturn::class,
    'factory-plugin', 'compiled-factory-plugin' => \MageLens\Compatibility\Model\LayoutFactoryClass::class,
    default => null,
};
$factoryPlugin = in_array($mode, ['factory-plugin', 'compiled-factory-plugin', 'factory-fallback'], true);
if ($plugin !== null || in_array($mode, ['fallback', 'compiled-fallback', 'factory-fallback', 'missing-wrapper', 'registration-limit'], true)) {
    layoutNativeInterceptor($manager, $factoryPlugin ? BlockFactory::class : BlockGenerator::class, $plugin, str_starts_with($mode, 'compiled-'));
}
$manager->get(\Magento\Framework\App\ViewInterface::class);
$page = $manager->get(\Magento\Framework\View\Result\PageFactory::class)->create(true, ['isIsolated' => true]);
$page->addHandle($handle);
if ($mode === 'factory') {
    $pool = (new ReflectionProperty(\Magento\Framework\View\Layout::class, 'generatorPool'))->getValue($page->getLayout());
    (new ReflectionProperty(BlockGenerator::class, 'blockFactory'))->setValue($pool->getGenerator('block'),
        $manager->create(\MageLens\Compatibility\Model\LayoutBlockFactory::class));
}
if ($mode === 'object-manager') {
    $pool = (new ReflectionProperty(\Magento\Framework\View\Layout::class, 'generatorPool'))->getValue($page->getLayout());
    $factory = (new ReflectionProperty(BlockGenerator::class, 'blockFactory'))->getValue($pool->getGenerator('block'));
    (new ReflectionProperty(BlockFactory::class, 'objectManager'))->setValue($factory,
        new \MageLens\Compatibility\Model\LayoutObjectManager($manager));
}
if ($mode === 'manager-restore') {
    $pool = (new ReflectionProperty(\Magento\Framework\View\Layout::class, 'generatorPool'))->getValue($page->getLayout());
    $factory = (new ReflectionProperty(BlockGenerator::class, 'blockFactory'))->getValue($pool->getGenerator('block'));
    if ((new ReflectionClass(BlockFactory::class))->hasProperty('objectManagerConfig')) {
        $config = $manager->create(\MageLens\Compatibility\Model\LayoutFactoryConfig::class);
        $config->initialize($factory, $manager);
        (new ReflectionProperty(BlockFactory::class, 'objectManagerConfig'))->setValue($factory, $config);
    } else {
        (new ReflectionProperty(BlockFactory::class, 'objectManager'))->setValue($factory,
            new \MageLens\Compatibility\Model\LayoutRestoringObjectManager($manager, $factory));
    }
}
$block = $page->getLayout()->getBlock('magelens.layout.package.native');
$html = $mode === 'missing-render-path' ? $page->getLayout()->renderElement('magelens.layout.package.native') : $block->toHtml();
if (!str_contains($html, 'data-layout-mutation>xml-value</span>') || $block->getData('late') !== 'xml-value') {
    throw new RuntimeException('Native class replacement changed the fixture output');
}
if ($mode === 'factory' && \MageLens\Compatibility\Model\LayoutBlockFactory::$calls === 0) {
    throw new RuntimeException('Native custom block factory was bypassed');
}
if ($plugin !== null && $plugin::$calls === 0) throw new RuntimeException('Native equal class replacement was bypassed');
if (in_array($mode, ['object-manager', 'manager-restore'], true) && \MageLens\Compatibility\Model\LayoutObjectManager::$calls === 0) {
    throw new RuntimeException('Native custom object-manager dependency was bypassed');
}
if ($mode === 'manager-restore' && (new ReflectionProperty(BlockFactory::class, 'objectManager'))->getValue($factory) !== $manager) {
    throw new RuntimeException('Native factory dependency was not restored before the completed result');
}
try {
    $collector->finish();
    if (str_starts_with($mode, 'missing-') || in_array($mode, ['registration-limit', 'manager-depth'], true)) throw new LogicException('Missing native block factory observation was accepted');
} catch (RuntimeException $error) {
    $expected = ['missing-registration' => ['Missing native layout block registration hook evidence', 'Missing native layout producer hook evidence'],
        'missing-render-path' => 'Missing native layout block rendering hook evidence',
        'missing-block-process' => 'Missing native block process hook evidence',
        'missing-factory' => 'Missing native block factory hook evidence',
        'missing-creation' => 'Missing native block creation hook evidence',
        'missing-wrapper' => 'Missing generated layout producer hook evidence',
        'missing-creation-pre' => 'Unbalanced layout producer hook evidence',
        'missing-creation-post' => 'Unbalanced XML handoff hook evidence',
        'registration-limit' => 'Generated layout producer hook registrations exceeded 1024 methods',
        'missing-manager' => 'Missing native block object manager hook evidence',
        'missing-manager-pre' => 'Missing native block object manager hook evidence',
        'missing-manager-post' => 'Unbalanced block object creation hook evidence',
        'manager-depth' => 'Layout block object creation nesting exceeded 256 calls'][$mode] ?? null;
    if (!$expected || !array_filter((array) $expected, static fn($message) => str_contains($error->getMessage(), $message))) throw $error;
    echo "Verified native block creation publication guard for $mode.\n";
    exit;
}
$events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
foreach ($declarations as $declaration) {
    if (!in_array($declaration['layout']['kind'], ['block-class', 'block', 'template', 'argument'], true)) continue;
    $effects = array_values(array_unique(array_column(array_filter($events,
        static fn($event) => $event['id'] === $declaration['id']), 'type')));
    if ($declaration['layout']['kind'] === 'argument') {
        if (!in_array('layout-argument-evaluated', $effects, true)) throw new RuntimeException('Native value evaluation lost its independent origin');
        if ($plugin !== null && !$factoryPlugin) {
            sort($effects);
            if ($effects !== ['layout-argument-application-unconfirmed', 'layout-argument-evaluated']) {
                throw new RuntimeException('Unverified creation retained native argument application ownership');
            }
        } elseif (!in_array('layout-argument-applied', $effects, true) || !in_array('layout-argument-read', $effects, true)) {
            throw new RuntimeException('Native argument application lost its independent origin');
        }
    } elseif ($declaration['layout']['kind'] === 'block-class') {
        $expected = match ($mode) {
            'native', 'native-production', 'fallback', 'compiled-fallback', 'factory-fallback' => 'layout-block-class-applied',
            'empty-class' => 'layout-block-class-defaulted',
            default => 'layout-block-class-origin-unconfirmed',
        };
        if ($effects !== [$expected]) throw new RuntimeException('Block class evidence differs for ' . $mode
            . ': expected ' . $expected . ', observed ' . implode(', ', $effects));
    } elseif ($declaration['layout']['kind'] === 'block' && !in_array('layout-block-rendered', $effects, true)) {
        throw new RuntimeException('Native block instruction lost its independent render origin');
    } elseif ($declaration['layout']['kind'] === 'template' && !in_array('layout-template-executed', $effects, true)) {
        throw new RuntimeException('Native template instruction lost its independent execution origin');
    }
}
echo "Verified native block class ownership boundary for $mode.\n";
