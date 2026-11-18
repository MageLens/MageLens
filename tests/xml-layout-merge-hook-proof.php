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

$mode = $argv[1] ?? 'native';
$modes = [
    'native', 'theme-getter', 'exposed', 'reset', 'document-limit', 'string-plugin', 'xml-plugin',
    'parser-plugin', 'late-parser-plugin', 'unused-parser', 'string-no-parent',
    'xml-no-parent', 'package-no-parent', 'opaque-update', 'missing-string',
    'missing-document', 'missing-package', 'compiled-selection', 'selection-no-parent',
    'native-selection', 'package-event', 'package-event-disabled', 'missing-event-manager',
    'missing-event-config', 'missing-event-invoker', 'missing-event-observer', 'event-depth', 'observer-depth',
];
if (!in_array($mode, $modes, true)) throw new RuntimeException('Unknown merge proof mode');
$files = [];
foreach (glob(BP . '/app/code/MageLens/Compatibility/view/frontend/layout/*.xml') as $file) {
    $path = substr($file, strlen(BP) + 1);
    $source = file_get_contents($file);
    $files[] = ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
        'declarations' => LayoutManifest::declarations($path, $source)];
}
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
if ($mode === 'document-limit') {
    $document = new \DOMDocument();
    $document->loadXML('<layout/>');
    (new \ReflectionProperty(LayoutCoverage::class, 'documents'))->setValue($collector,
        array_fill(0, 256, ['root' => $document->documentElement, 'targets' => [], 'context' => [], 'readerObserved' => false]));
}
if (in_array($mode, ['event-depth', 'observer-depth'], true)) {
    $events = (new ReflectionProperty(LayoutCoverage::class, 'packageEvents'))->getValue($collector);
    (new ReflectionProperty(\MageLens\XmlCoverage\LayoutPackageEvents::class,
        $mode === 'event-depth' ? 'dispatching' : 'invoking'))->setValue($events, array_fill(0, 256, null));
}
foreach ($callbacks as [$class, $method, $pre, $post]) {
    $eventHook = ['missing-event-manager' => [\Magento\Framework\Event\ManagerInterface::class, 'dispatch'],
        'missing-event-config' => [\Magento\Framework\Event\ConfigInterface::class, 'getObservers'],
        'missing-event-invoker' => [\Magento\Framework\Event\InvokerInterface::class, 'dispatch'],
        'missing-event-observer' => [\Magento\Framework\Event\Invoker\InvokerDefault::class, '_callObserverMethod']][$mode] ?? null;
    if ($eventHook === [$class, $method]) continue;
    $missing = ['missing-string' => 'asString', 'missing-document' => 'asSimplexml', 'missing-package' => 'getFileLayoutUpdatesXml'];
    if (($missing[$mode] ?? null) === $method && in_array($class,
        [\Magento\Framework\View\Model\Layout\Merge::class, \Magento\Framework\View\Layout\ProcessorInterface::class], true)) continue;
    if (!\OpenTelemetry\Instrumentation\hook($class, $method, $pre, $post)) throw new RuntimeException('Cannot register ownership proof hook');
}
$manager = \Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$manager->get(\Magento\Framework\App\State::class)->setAreaCode('frontend');
$manager->get(\Magento\Framework\App\AreaList::class)->getArea('frontend')->load(\Magento\Framework\App\Area::PART_CONFIG);
$cacheState = $manager->get(\Magento\Framework\App\Cache\StateInterface::class);
foreach (['layout', 'block_html', 'full_page'] as $type) $cacheState->setEnabled($type, false);
if (in_array($mode, ['string-plugin', 'xml-plugin'], true)) {
    layoutNativeInterceptor($manager, \Magento\Framework\View\Model\Layout\Merge::class,
        $mode === 'string-plugin' ? \MageLens\Compatibility\Model\LayoutStringPlugin::class
            : \MageLens\Compatibility\Model\LayoutMergePlugin::class);
}
$replacement = match ($mode) {
    'theme-getter' => \MageLens\Compatibility\Model\LayoutThemeGetter::class,
    'string-no-parent' => \MageLens\Compatibility\Model\LayoutStringReplacement::class,
    'xml-no-parent' => \MageLens\Compatibility\Model\LayoutDocumentReplacement::class,
    'package-no-parent' => \MageLens\Compatibility\Model\LayoutPackageReplacement::class,
    'compiled-selection' => \MageLens\Compatibility\Model\LayoutPageLayoutReplacement::class,
    'selection-no-parent' => \MageLens\Compatibility\Model\LayoutPageLayoutNoParent::class,
    default => null,
};
if ($mode === 'native-selection') layoutNativeInterceptor($manager, \Magento\Framework\View\Model\Layout\Merge::class, null);
if ($replacement !== null) layoutNativeInterceptor($manager, \Magento\Framework\View\Model\Layout\Merge::class, $replacement, $mode === 'compiled-selection');
if ($mode === 'parser-plugin') {
    layoutNativeInterceptor($manager, \Magento\Framework\View\Layout\Argument\Parser::class,
        \MageLens\Compatibility\Model\LayoutArgumentParserPlugin::class);
}
if ($mode === 'unused-parser') {
    layoutNativeInterceptor($manager, \Magento\Framework\View\Layout\Argument\Parser::class,
        \MageLens\Compatibility\Model\LayoutDormantParserPlugin::class);
}
$activated = false;
if ($mode === 'late-parser-plugin') {
    $nativeParser = \Magento\Framework\View\Layout\Argument\Parser::class;
    layoutNativeInterceptor($manager, $nativeParser, null);
    \OpenTelemetry\Instrumentation\hook($nativeParser, 'getConverter', null,
        static function () use ($manager, $nativeParser, &$activated): void {
            if ($activated) return;
            $plugins = $manager->get(\Magento\Framework\Interception\PluginListInterface::class);
            $plugins->merge([$nativeParser => ['plugins' => ['magelens_late_parser' => [
                'instance' => \MageLens\Compatibility\Model\LayoutArgumentParserPlugin::class, 'sortOrder' => 1]]]]);
            $inherited = new \ReflectionProperty(\Magento\Framework\Interception\PluginList\PluginList::class, '_inherited');
            $data = $inherited->getValue($plugins);
            unset($data[$nativeParser]);
            $inherited->setValue($plugins, $data);
            $activated = true;
        });
}
if (in_array($mode, ['package-event', 'package-event-disabled'], true)) {
    $config = $manager->get(\Magento\Framework\Event\ConfigInterface::class);
    $data = (new ReflectionProperty(\Magento\Framework\Event\Config::class, '_dataContainer'))->getValue($config);
    $data->merge(['load_file_layout_updates_xml_after' => ['magelens_package_observer' => [
        'name' => 'magelens_package_observer', 'disabled' => $mode === 'package-event-disabled', 'instance' => \MageLens\Compatibility\Model\LayoutPackageObserver::class]]]);
}
$manager->get(\Magento\Framework\App\ViewInterface::class);
$page = $manager->get(\Magento\Framework\View\Result\PageFactory::class)->create(true, ['isIsolated' => true]);
$fixture = $mode === 'unused-parser' ? 'unused' : 'native';
if (in_array($mode, ['compiled-selection', 'selection-no-parent', 'native-selection'], true)) {
    $page->addHandle('coverageprobe_selector_index');
    $page->getLayout()->getBlock('magelens.layout.selector');
    if (!$page->getLayout()->hasElement('magelens.layout.selector')
        || ($replacement !== null && $replacement::$calls === 0)) {
        throw new RuntimeException('Native compiled page-layout replacement changed the wireframe');
    }
    $collector->finish();
    $events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
    foreach ($files as $file) {
        if (!str_ends_with($file['path'], '/coverageprobe_selector_index.xml')) continue;
        $selection = array_values(array_filter($file['declarations'], static fn($item) => $item['layout']['kind'] === 'wireframe-selection'))[0];
    }
    $effects = array_values(array_unique(array_column(array_filter($events, static fn($event) => $event['id'] === $selection['id']), 'type')));
    if ($effects !== [$mode === 'native-selection' ? 'layout-wireframe-selected' : 'layout-wireframe-origin-unconfirmed']) throw new RuntimeException('Compiled getter replacement retained the XML page-layout selection');
    echo "Verified native page-layout ownership boundary for $mode.\n";
    exit;
}
$page->addHandle('coverageprobe_packagemutation_' . $fixture);
$layout = $page->getLayout();
if ($mode === 'opaque-update') {
    $merge = $layout->getUpdate();
    $merge->load();
    $merge->addUpdate(new \MageLens\Compatibility\Model\LayoutUpdateStringable());
}
if ($mode === 'reset') {
    $merge = $layout->getUpdate();
    $merge->load();
    $updates = $merge->asArray();
    $merge->__destruct();
    foreach ($updates as $update) $merge->addUpdate($update);
}
if ($mode === 'exposed') {
    $package = $layout->getUpdate()->getFileLayoutUpdatesXml();
    $element = $package->xpath('./*[@id="coverageprobe_packagemutation_native"]//block')[0];
    $node = dom_import_simplexml($element);
    $node->parentNode->replaceChild($node->cloneNode(true), $node);
}
$block = $layout->getBlock('magelens.layout.package.' . $fixture);
$output = $block->toHtml();
if ($fixture === 'native' && $block->getData('late') !== 'xml-value') throw new RuntimeException('Native late argument changed');
if ($fixture === 'native' && !str_contains($output, 'data-layout-mutation>xml-value</span>')) throw new RuntimeException('Native merge replacement changed output');
if ($fixture === 'unused' && (!str_contains($output, 'data-layout-structure')
    || class_exists(\MageLens\Compatibility\Model\LayoutDormantParserPlugin::class, false))) {
    throw new RuntimeException('Collector evaluated plugin metadata for an unused parser');
}
if ($mode === 'string-plugin' && \MageLens\Compatibility\Model\LayoutStringPlugin::$strings === 0) {
    throw new RuntimeException('Native serialization plugin was bypassed');
}
if ($mode === 'xml-plugin' && \MageLens\Compatibility\Model\LayoutMergePlugin::$documents === 0) {
    throw new RuntimeException('Native mutable XML plugin was bypassed');
}
if (in_array($mode, ['parser-plugin', 'late-parser-plugin'], true) && \MageLens\Compatibility\Model\LayoutArgumentParserPlugin::$calls === 0) {
    throw new RuntimeException('Native no-parent parser plugin was bypassed');
}
if ($mode === 'late-parser-plugin' && !$activated) throw new RuntimeException('Late parser activation was bypassed');
if ($mode === 'package-event' && \MageLens\Compatibility\Model\LayoutPackageObserver::$calls === 0) throw new RuntimeException('Native package observer was bypassed');
if ($mode === 'opaque-update' && (\MageLens\Compatibility\Model\LayoutUpdateStringable::$calls === 0
    || \MageLens\Compatibility\Model\LayoutUpdateStringable::$collectorCalls !== 0)) {
    throw new RuntimeException('Collector repeated application XML update conversion');
}
if ($mode === 'package-event-disabled' && class_exists(\MageLens\Compatibility\Model\LayoutPackageObserver::class, false)) throw new RuntimeException('Disabled native observer was instantiated');
if ($mode === 'theme-getter') {
    $merge = $layout->getUpdate();
    $theme = (new ReflectionProperty(\Magento\Framework\View\Model\Layout\Merge::class, 'theme'))->getValue($merge);
    $expectedTheme = $theme->getFullPath();
    if ($merge->getTheme()->getFullPath() === $expectedTheme) throw new RuntimeException('Native theme getter replacement was bypassed');
}
if ($mode === 'theme-getter' && \MageLens\Compatibility\Model\LayoutThemeGetter::$collectorCalls !== 0) throw new RuntimeException('Collector invoked the application theme getter');
if ($replacement !== null && $mode !== 'theme-getter' && $replacement::$calls === 0) throw new RuntimeException('Native replacement without parent was bypassed');
try {
    [, , $limits] = $collector->finish();
    if ($mode === 'package-no-parent' && !in_array('mutable-layout-package', $limits, true)) {
        throw new RuntimeException('Missing programmatic package provider limitation');
    }
    if (str_starts_with($mode, 'missing-')) throw new LogicException('Missing merge hook was accepted');
} catch (RuntimeException $error) {
    $expected = ['missing-string' => 'Missing native layout serialization hook evidence',
        'missing-document' => 'Missing native layout document hook evidence',
        'missing-package' => 'Missing native layout package getter hook evidence',
        'missing-event-manager' => 'Missing native layout package event hook evidence',
        'missing-event-config' => 'Missing native layout event dispatch hook evidence',
        'missing-event-invoker' => 'Missing native layout event dispatch hook evidence',
        'missing-event-observer' => 'Missing native layout observer hook evidence',
        'event-depth' => 'Layout event nesting exceeded 256 calls',
        'observer-depth' => 'Layout observer nesting exceeded 256 calls'][$mode] ?? null;
    if (!$expected || !str_contains($error->getMessage(), $expected)) throw $error;
    echo "Verified native merge publication guard for $mode.\n";
    exit;
}
$events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
$items = [];
foreach ($files as $file) {
    if (!str_ends_with($file['path'], '/coverageprobe_packagemutation_' . $fixture . '.xml')) continue;
    $items = array_values(array_filter($file['declarations'], static fn($item) => $item['supported']));
}
if (!$items) throw new RuntimeException('Missing merge proof declarations');
foreach ($items as $item) {
    if ($mode === 'late-parser-plugin' && !in_array($item['layout']['kind'], ['argument', 'position-name'], true)) continue;
    $eventsForSource = array_filter($events, static fn($event) => $event['id'] === $item['id']);
    if ($mode === 'theme-getter') {
        foreach ($eventsForSource as $event) {
            if ($event['theme'] !== $expectedTheme) throw new RuntimeException('Collector recorded the exposed theme instead of the native selected theme');
        }
    }
    $effects = array_values(array_unique(array_column($eventsForSource, 'type')));
    if (in_array($mode, ['native', 'theme-getter', 'unused-parser', 'package-event-disabled'], true)) {
        if (!$effects || in_array('layout-xml-ownership-revoked', $effects, true)) throw new RuntimeException('Native merge lost original ownership');
    } elseif (in_array($mode, ['parser-plugin', 'late-parser-plugin'], true) && $item['layout']['kind'] === 'position-name') {
        sort($effects);
        if ($effects !== ['layout-position-name-applied', 'layout-xml-ownership-revoked']) throw new RuntimeException('Earlier native name ownership was lost');
    } elseif ($mode === 'package-no-parent') {
        if ($effects !== []) throw new RuntimeException('Unread original XML received programmatic package evidence');
    } elseif ($effects !== [$mode === 'document-limit' ? 'layout-origin-limit' : 'layout-xml-ownership-revoked']) {
        throw new RuntimeException('Replacement merge retained original ownership for ' . $item['node']);
    }
}
echo "Verified native merge ownership boundary for $mode.\n";
