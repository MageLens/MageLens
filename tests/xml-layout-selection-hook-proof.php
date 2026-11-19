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
require __DIR__ . '/xml-layout-native-interceptor.php';

use MageLens\XmlCoverage\{LayoutCoverage, LayoutManifest, Recorder};
use Magento\Framework\App\Area;

$areaCode = $argv[1] ?? 'frontend';
$mode = $argv[2] ?? 'native';
if (!in_array($areaCode, ['frontend', 'adminhtml'], true)
    || !in_array($mode, ['native', 'standard', 'missing-getter', 'missing-plugin', 'missing-condition', 'missing-lookup'], true)) {
    throw new RuntimeException('Unknown native page-layout selection proof');
}
$handle = $areaCode === 'frontend' ? 'coverageprobe_selector_index' : 'application_blog_manage_index';
$path = $areaCode === 'frontend'
    ? 'app/code/MageLens/Compatibility/view/frontend/layout/' . $handle . '.xml'
    : 'app/code/Application/Blog/view/adminhtml/layout/' . $handle . '.xml';
$source = file_get_contents(BP . '/' . $path);
$declarations = LayoutManifest::declarations($path, $source);
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets([
    ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source), 'declarations' => $declarations],
]));
$pluginClass = 'MageOS\\ShoppingFeed\\Plugin\\Adminhtml\\FeedEditorTheme';
foreach ($callbacks as [$class, $method, $pre, $post]) {
    if ($mode === 'missing-getter' && $class === Magento\Framework\View\Layout\ProcessorInterface::class && $method === 'getPageLayout') continue;
    if ($mode === 'missing-plugin' && $class === $pluginClass && $method === 'afterGetPageLayout') continue;
    if ($mode === 'missing-condition' && $class === $pluginClass && $method === 'isFeedEditor') continue;
    if ($mode === 'missing-lookup' && $class === Magento\Framework\Interception\PluginListInterface::class
        && $method === 'getPlugin' && $post instanceof Closure
        && (new ReflectionFunction($post))->getClosureThis() instanceof MageLens\XmlCoverage\LayoutSelectionOwnership) continue;
    if (!\MageLens\XmlCoverage\LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot register selection proof hook');
}
$pluginCalls = 0;
OpenTelemetry\Instrumentation\hook($pluginClass, 'afterGetPageLayout', null,
    static function () use (&$pluginCalls): void { $pluginCalls++; });
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode($areaCode);
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea($areaCode);
$area->load(Area::PART_CONFIG);
$area->load(Area::PART_DESIGN);
$cache = $objects->get(Magento\Framework\App\Cache\StateInterface::class);
foreach (['layout', 'block_html', 'full_page'] as $type) $cache->setEnabled($type, false);
if (in_array($mode, ['standard', 'missing-lookup'], true)) {
    layoutNativeInterceptor($objects, Magento\Framework\View\Model\Layout\Merge::class, null);
}
$objects->get(Magento\Framework\App\ViewInterface::class);
$page = $objects->get(Magento\Framework\View\Result\PageFactory::class)->create(true, ['isIsolated' => true]);
$page->addHandle($handle);
$element = $areaCode === 'frontend' ? 'magelens.layout.selector' : 'content';
if (!$page->getLayout()->hasElement($element)) throw new RuntimeException('Native selected wireframe failed to build');
if ($areaCode === 'adminhtml' && class_exists($pluginClass) && $pluginCalls === 0) {
    throw new RuntimeException('Native Mage-OS Admin page-layout plugin was bypassed');
}
echo "Verified installed $areaCode wireframe construction and native page-layout handoff.\n";
if (in_array('--native-only', $argv, true)) exit;
try {
    $collector->finish();
    if (str_starts_with($mode, 'missing-')) throw new LogicException('Missing selection evidence was accepted');
} catch (RuntimeException $error) {
    $expected = ['missing-getter' => 'Missing native page-layout getter hook evidence',
        'missing-plugin' => 'Missing native page-layout after-plugin hook evidence',
        'missing-condition' => 'Missing native page-layout plugin condition hook evidence'][$mode] ?? null;
    if ($mode === 'missing-lookup') $expected = 'Missing native page-layout plugin lookup hook evidence';
    if (!$expected || !str_contains($error->getMessage(), $expected)) throw $error;
    echo "Verified native selection publication guard for $mode.\n";
    exit;
}
$selection = array_values(array_filter($declarations, static fn($item) => $item['layout']['kind'] === 'wireframe-selection'))[0];
$events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
$effects = array_values(array_unique(array_column(array_filter($events,
    static fn($event) => $event['id'] === $selection['id']), 'type')));
if ($effects !== ['layout-wireframe-selected']) throw new RuntimeException('Installed native page-layout handoff lost original selection ownership');
echo "Verified original installed $areaCode page-layout selection.\n";
