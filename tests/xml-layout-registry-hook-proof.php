<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

// Run against a disposable installation with the compatibility fixture modules.
require '/var/www/html/app/bootstrap.php';
$hooks = dirname(getenv('MAGELENS_XML_HOOKS') ?: __DIR__ . '/../docker/php/xml-hooks.php');
require $hooks . '/xml-data.php';
require $hooks . '/xml-layout-runtime-hooks.php';
require $hooks . '/xml-layout-manifest.php';
require $hooks . '/xml-layout-registry.php';

use MageLens\XmlCoverage\{LayoutManifest, LayoutRegistryCoverage};
use Magento\Framework\App\Bootstrap;
use Magento\Framework\App\Cache\Type\Layout;
use Magento\Theme\Model\PageLayout\Config\Builder;

$mode = $argv[1] ?? 'native';
if (!in_array($mode, ['native', 'missing-import', 'missing-attribute', 'stale', 'limit', 'missing-cdata'], true)) throw new RuntimeException('Unknown proof mode');
$files = [];
foreach (['Compatibility', 'LayoutOverlay'] as $module) {
    foreach (['view/frontend/layouts.xml', 'etc/frontend/page_types.xml'] as $suffix) {
        $path = "app/code/MageLens/$module/$suffix";
        $source = file_get_contents(BP . '/' . $path);
        $files[] = ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
            'declarations' => LayoutManifest::declarations($path, $source)];
    }
}
$sources = LayoutManifest::targets($files);
if ($mode === 'stale') $sources[$files[0]['path']]['hash'] = str_repeat('0', 64);
$events = [];
$collector = new LayoutRegistryCoverage($sources,
    static fn() => ['area' => 'frontend', 'theme' => 'frontend/MageLens/proof'],
    static function ($id, $effect) use (&$events) { $events[$id][$effect] = true; });
if ($mode === 'limit') {
    $node = (new DOMDocument())->createElement('fixture');
    (new ReflectionProperty(LayoutRegistryCoverage::class, 'retained'))->setValue($collector, array_fill(0, 16384, $node));
}
foreach ($collector->hooks() as [$class, $method, $pre, $post]) {
    if (($mode === 'missing-import' && $class === DOMDocument::class && $method === 'importNode')
        || ($mode === 'missing-attribute' && $class === DOMElement::class && $method === 'setAttribute')
        || ($mode === 'missing-cdata' && $class === \Magento\Framework\Config\Dom::class && $method === 'replaceCdataNode')) continue;
    if (!\MageLens\XmlCoverage\LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Hook registration failed');
}
$manager = Bootstrap::create(BP, $_SERVER)->getObjectManager();
$manager->get(\Magento\Framework\App\State::class)->setAreaCode('frontend');
$cacheState = $manager->get(\Magento\Framework\App\Cache\StateInterface::class);
$cacheState->setEnabled('layout', true);
$cacheState->setEnabled('config', true);
$manager->get(Layout::class)->remove(Builder::CACHE_KEY_LAYOUTS);
$config = $manager->create(Builder::class)->getPageLayoutsConfig();
$options = array_column($config->toOptionArray(), 'label', 'value');
if ($options['magelens_registry_override'] !== 'Registry overlay' || $options['magelens_registry_empty'] !== 'Registry retained'
    || $options['magelens_registry_cdata'] !== ''
    || $options['magelens_registry_mixed'] !== 'Base prefixoverlay middle base suffix') throw new RuntimeException('Native registry fixture mismatch');
\MageLens\XmlCoverage\LayoutRuntimeHooks::assertHealthy();
if ($mode === 'limit') {
    [$healthy, $limits] = $collector->finish();
    if ($events || !$healthy || !in_array('layout-registry-limit', $limits, true)) throw new RuntimeException('Registry bounds leaked source credit');
    echo "Verified bounded native registry tracing preserves output and grants zero source hits.\n";
    exit;
}
try {
    [$healthy] = $collector->finish();
    if ($mode !== 'native') throw new LogicException('Missing integrity failure for ' . $mode);
} catch (RuntimeException $error) {
    $expected = ['missing-import' => 'Missing native registry import', 'missing-attribute' => 'Missing native registry attribute',
        'stale' => 'Registry source changed', 'missing-cdata' => 'Missing native registry CDATA'][$mode] ?? null;
    if (!$expected || !str_contains($error->getMessage(), $expected)) throw $error;
    echo "Verified native registry integrity failure for $mode.\n";
    exit;
}
if (!$healthy) throw new RuntimeException('Native registry consumer heartbeat missing');
$base = $files[0]['declarations'];
$entry = array_values(array_filter($base, static fn($item) => $item['layout']['element'] === 'magelens_fixture'
    && $item['layout']['kind'] === 'registry-entry'))[0];
$label = array_values(array_filter($base, static fn($item) => $item['node'] === $entry['node'] . '/label'))[0];
if (!isset($events[$entry['id']]['layout-registry-entry-consumed'], $events[$label['id']]['layout-registry-label-consumed'])) {
    throw new RuntimeException('Cold native registry origin missing');
}
foreach ([$files[0], $files[2]] as $file) {
    $mixed = array_values(array_filter($file['declarations'], static fn($item) => $item['layout']['element'] === 'magelens_registry_mixed'
        && $item['layout']['kind'] === 'registry-entry'))[0];
    $fragment = array_values(array_filter($file['declarations'], static fn($item) => $item['node'] === $mixed['node'] . '/label'))[0];
    if (!isset($events[$fragment['id']]['layout-registry-label-consumed'])) throw new RuntimeException('Surviving native mixed label fragment lost its origin');
}
$events = [];
$manager->create(Builder::class)->getPageLayoutsConfig()->toOptionArray();
if (!isset($events[$label['id']]['layout-registry-cache-unconfirmed'])
    || isset($events[$label['id']]['layout-registry-label-consumed'])) throw new RuntimeException('Warm registry cache earned fresh source credit');
$events = [];
$property = new ReflectionProperty(\Magento\Framework\Config\AbstractXml::class, '_data');
$property->setValue($config, $property->getValue($config));
$config->toOptionArray();
if ($events) throw new RuntimeException('Equal-valued runtime replacement retained XML ownership');
foreach (['setValue', 'setRawValue', 'setRawValueWithoutLazyInitialization'] as $setter) {
    $manager->get(Layout::class)->remove(Builder::CACHE_KEY_LAYOUTS);
    $freshConfig = $manager->create(Builder::class)->getPageLayoutsConfig();
    $events = [];
    $property->$setter($freshConfig, $property->getValue($freshConfig));
    $freshConfig->toOptionArray();
    if ($events) throw new RuntimeException('Reflection registry replacement retained source ownership through ' . $setter);
}
$manager->get(Layout::class)->remove(Builder::CACHE_KEY_LAYOUTS);
$freshConfig = $manager->create(Builder::class)->getPageLayoutsConfig();
$opaque = new class {
    public function __serialize(): array { throw new LogicException('Registry observation serialized an application object'); }
};
$replaceData = Closure::bind(function ($value) { $this->_data = ['opaque' => $value]; }, $freshConfig, \Magento\Framework\Config\AbstractXml::class);
$replaceData($opaque);
$events = [];
if (!$freshConfig->hasPageLayout('opaque') || $events) throw new RuntimeException('Opaque registry replacement affected native behavior or earned source credit');

$manager->get(\Magento\Framework\App\Cache\Type\Config::class)->remove('page_types_config');
$storage = $manager->create('Magento\\Framework\\View\\Layout\\PageType\\Config\\Data');
$typeConfig = $manager->create(\Magento\Framework\View\Layout\PageType\Config::class, ['dataStorage' => $storage]);
$types = $typeConfig->getPageTypes();
if ($types['magelens_page_type_fixture']->getData('label') !== 'Page type overlay') throw new RuntimeException('Native page type label mismatch');
$typeLabel = array_values(array_filter($files[3]['declarations'], static fn($item) => $item['layout']['element'] === 'magelens_page_type_fixture'
    && $item['layout']['kind'] === 'page-type-label'))[0];
if (!isset($events[$typeLabel['id']]['layout-page-type-applied'], $events[$typeLabel['id']]['layout-page-type-read'])) {
    throw new RuntimeException('Cold page type ownership missing');
}
$events = [];
$types['magelens_page_type_fixture']->setData('label', 'Page type overlay');
$types['magelens_page_type_fixture']->getData('label');
if ($events) throw new RuntimeException('Equal-valued page type setter retained XML read ownership');
$warmStorage = $manager->create('Magento\\Framework\\View\\Layout\\PageType\\Config\\Data');
$manager->create(\Magento\Framework\View\Layout\PageType\Config::class, ['dataStorage' => $warmStorage])->getPageTypes();
[$healthy, $limits] = $collector->finish();
if ($events || !in_array('layout-page-types-cache', $limits, true)) throw new RuntimeException('Warm page type cache earned fresh source credit');
echo "Verified cold registry and page type origins, warm cache zero hits and equal-valued runtime replacements.\n";
