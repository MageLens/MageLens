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

$mode = $argv[1] ?? 'native';
if (!in_array($mode, ['native', 'fallback', 'plugin', 'compiled-fallback', 'compiled-plugin', 'parser', 'reader', 'missing-reader'], true)) throw new RuntimeException('Unknown ownership proof mode');
$files = [];
foreach (glob(BP . '/app/code/MageLens/Compatibility/view/frontend/layout/*.xml') as $file) {
    $path = substr($file, strlen(BP) + 1);
    $source = file_get_contents($file);
    $files[] = ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
        'declarations' => LayoutManifest::declarations($path, $source)];
}
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
foreach ($callbacks as [$class, $method, $pre, $post]) {
    if ($mode === 'missing-reader' && $class === \Magento\Framework\View\Layout\ReaderInterface::class && $method === 'interpret') continue;
    if (!\MageLens\XmlCoverage\LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot register ownership proof hook');
}
$manager = \Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$manager->get(\Magento\Framework\App\State::class)->setAreaCode('frontend');
$manager->get(\Magento\Framework\App\AreaList::class)->getArea('frontend')->load(\Magento\Framework\App\Area::PART_CONFIG);
$manager->get(\Magento\Framework\App\AreaList::class)->getArea('frontend')->load(\Magento\Framework\App\Area::PART_DESIGN);
$cacheState = $manager->get(\Magento\Framework\App\Cache\StateInterface::class);
foreach (['layout', 'block_html', 'full_page'] as $type) $cacheState->setEnabled($type, false);
$wrapped = false;
$pluginMode = in_array($mode, ['plugin', 'compiled-plugin'], true);
if (in_array($mode, ['fallback', 'plugin', 'compiled-fallback', 'compiled-plugin'], true)) {
    $native = \Magento\Framework\View\Layout\Reader\Visibility\Condition::class;
    $interceptor = layoutNativeInterceptor($manager, $native,
        $pluginMode ? \MageLens\Compatibility\Model\LayoutConditionPlugin::class : null,
        str_starts_with($mode, 'compiled-'));
    \OpenTelemetry\Instrumentation\hook($native, 'parseConditions', static function ($subject) use (&$wrapped, $interceptor) {
        if (get_class($subject) === $interceptor) $wrapped = true;
    });
}
$fragment = $manager->create(\Magento\Framework\View\Result\Layout::class, ['isIsolated' => true]);
$fragment->addHandle(match ($mode) {
    'parser' => 'coverageprobe_conditionmutation_index',
    'reader' => 'coverageprobe_readermutation_index',
    default => 'coverageprobe_component_index',
});
$layout = $fragment->getLayout();
if (!$layout->getBlock('magelens_layout_ui') instanceof \Magento\Ui\Component\Wrapper\UiComponent
    || $layout->hasElement('magelens_layout_ui_denied')) throw new RuntimeException('Native UI fixture mismatch');
$output = $layout->getOutput();
if (!str_contains($output, 'data-layout-ui-proof>verified') || !str_contains($output, 'data-layout-ui-effect="calls">verified')) {
    throw new RuntimeException('Native ownership fixture changed the component effect');
}
try {
    $collector->finish();
    if ($mode === 'missing-reader') throw new LogicException('Missing ownership hook was accepted');
} catch (RuntimeException $error) {
    if ($mode !== 'missing-reader' || !str_contains($error->getMessage(), 'Missing native layout reader ownership hook evidence')) throw $error;
    echo "Verified missing native reader ownership hook rejects publication.\n";
    exit;
}
$events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
$ids = [];
foreach ($files as $file) {
    if (!str_ends_with($file['path'], '/coverageprobe_component_index.xml')) continue;
    foreach ($file['declarations'] as $item) {
        if ($item['supported'] && (str_starts_with($item['layout']['kind'], 'visibility')
            || str_starts_with($item['layout']['kind'], 'condition-'))) $ids[$item['id']] = true;
    }
}
$conditional = array_filter($events, static fn($event) => isset($ids[$event['id']]));
if (!$conditional) throw new RuntimeException('Missing native ownership observations');
if (in_array($mode, ['fallback', 'plugin', 'compiled-fallback', 'compiled-plugin'], true) && !$wrapped) {
    throw new RuntimeException('Native condition interceptor was bypassed');
}
if ($pluginMode && \MageLens\Compatibility\Model\LayoutConditionPlugin::$calls === 0) {
    throw new RuntimeException('Native condition replacement plugin did not run');
}
if (in_array($mode, ['native', 'fallback', 'compiled-fallback'], true)) {
    if (!in_array('layout-condition-allowed', array_column($conditional, 'type'), true)) throw new RuntimeException('Native reader lost original ownership');
} else {
    foreach ($ids as $id => $_) {
        if (!array_filter($conditional, static fn($event) => $event['id'] === $id && $event['type'] === 'layout-xml-ownership-revoked')) {
            throw new RuntimeException('Replacement XML ownership was retained');
        }
    }
    if (array_values(array_unique(array_column($conditional, 'type'))) !== ['layout-xml-ownership-revoked']) {
        throw new RuntimeException('Replacement received original conditional hits');
    }
}
echo "Verified native reader ownership boundary for $mode.\n";
