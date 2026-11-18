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
use Magento\Framework\View\Element\Template;

$mode = $argv[1] ?? 'native';
if (!in_array($mode, ['native', 'getter', 'file', 'resolver', 'fallback', 'compiled-fallback', 'getter-plugin',
    'file-plugin', 'resolver-plugin', 'around', 'compiled-getter-plugin', 'compiled-file-plugin', 'compiled-resolver-plugin',
    'compiled-around', 'missing-getter', 'missing-file', 'missing-resolver', 'missing-getter-pre', 'missing-getter-post',
    'resolution-depth', 'resolver-fallback', 'compiled-resolver-fallback', 'custom-theme-plugin', 'missing-theme-plugin',
    'missing-plugin-lookup'], true)) throw new RuntimeException('Unknown template proof mode');
$case = in_array($mode, ['getter', 'file', 'resolver'], true) ? $mode : 'native';
$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_templateownership_' . $case . '.xml';
$source = file_get_contents(BP . '/' . $path);
$declarations = LayoutManifest::declarations($path, $source);
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets([
    ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source), 'declarations' => $declarations],
]));
foreach ($callbacks as [$class, $method, $pre, $post]) {
    $missing = ['missing-getter' => [Template::class, 'getTemplate'], 'missing-file' => [Template::class, 'getTemplateFile'],
        'missing-resolver' => [Template\File\Resolver::class, 'getTemplateFileName']][$mode] ?? null;
    if ($missing === [$class, $method]) continue;
    if ($mode === 'missing-theme-plugin' && $class === \Magento\ProductAlert\Model\UpdateThemeParams::class) continue;
    if ($mode === 'missing-plugin-lookup' && $class === \Magento\Framework\Interception\PluginListInterface::class && $method === 'getPlugin') continue;
    if ($class === Template::class && $method === 'getTemplate') {
        if ($mode === 'missing-getter-pre') $pre = null;
        if ($mode === 'missing-getter-post') $post = null;
    }
    if (!\OpenTelemetry\Instrumentation\hook($class, $method, $pre, $post)) throw new RuntimeException('Cannot register template proof hook');
}
$objects = \Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(\Magento\Framework\App\State::class)->setAreaCode('frontend');
$objects->get(\Magento\Framework\App\AreaList::class)->getArea('frontend')->load(\Magento\Framework\App\Area::PART_CONFIG);
$plugin = match ($mode) {
    'getter-plugin', 'compiled-getter-plugin' => \MageLens\Compatibility\Model\LayoutTemplateGetterPlugin::class,
    'file-plugin', 'compiled-file-plugin' => \MageLens\Compatibility\Model\LayoutTemplateFilePlugin::class,
    'resolver-plugin', 'compiled-resolver-plugin' => \MageLens\Compatibility\Model\LayoutTemplateResolverPlugin::class,
    'around', 'compiled-around' => \MageLens\Compatibility\Model\LayoutTemplateAround::class,
    default => null,
};
if ($mode === 'custom-theme-plugin') {
    $objects->configure(['preferences' => [\Magento\ProductAlert\Model\UpdateThemeParams::class => \MageLens\Compatibility\Model\LayoutTemplateBefore::class]]);
}
if ($plugin !== null || in_array($mode, ['fallback', 'compiled-fallback', 'resolver-fallback', 'compiled-resolver-fallback', 'missing-plugin-lookup'], true)) {
    layoutNativeInterceptor($objects, str_contains($mode, 'resolver-') || $mode === 'missing-plugin-lookup' ? Template\File\Resolver::class : Template::class,
        $plugin, str_starts_with($mode, 'compiled-'));
}
if ($mode === 'resolution-depth') {
    $templates = (new ReflectionProperty(LayoutCoverage::class, 'templateOwnership'))->getValue($collector);
    (new ReflectionProperty(\MageLens\XmlCoverage\LayoutTemplateOwnership::class, 'resolving'))->setValue($templates,
        array_fill(0, 256, ['block' => new stdClass()]));
}
$cache = $objects->get(\Magento\Framework\App\Cache\StateInterface::class);
foreach (['layout', 'block_html', 'full_page'] as $type) $cache->setEnabled($type, false);
$objects->get(\Magento\Framework\App\ViewInterface::class);
$page = $objects->get(\Magento\Framework\View\Result\PageFactory::class)->create(true, ['isIsolated' => true]);
$page->addHandle('coverageprobe_templateownership_' . $case);
$block = $page->getLayout()->getBlock('magelens.layout.template.' . $case);
if ($case === 'resolver') {
    (new ReflectionProperty(Template::class, 'resolver'))->setValue($block,
        $objects->create(\MageLens\Compatibility\Model\LayoutTemplateResolver::class));
}
if (!str_contains($block->toHtml(), 'data-layout-mutation>xml-value</span>')) {
    throw new RuntimeException('Native template fixture output changed');
}
if ($plugin !== null && $plugin::$calls === 0) throw new RuntimeException('Native template replacement plugin was bypassed');
if ($mode === 'custom-theme-plugin' && \MageLens\Compatibility\Model\LayoutTemplateBefore::$calls === 0) {
    throw new RuntimeException('Native theme-parameter replacement was bypassed');
}
echo "Verified native template fixture output for $mode.\n";
if (($argv[2] ?? '') === '--native-only') exit;
try {
    $collector->finish();
    if (str_starts_with($mode, 'missing-') || $mode === 'resolution-depth') throw new LogicException('Missing template observation was accepted');
} catch (RuntimeException $error) {
    $expected = ['missing-getter' => 'Missing native template getter hook evidence',
        'missing-file' => 'Missing native template file getter hook evidence',
        'missing-resolver' => 'Missing native template resolver hook evidence',
        'missing-theme-plugin' => 'Missing native template theme parameter hook evidence',
        'missing-plugin-lookup' => 'Missing native template resolver plugin lookup hook evidence',
        'missing-getter-pre' => 'Unbalanced layout producer hook evidence',
        'missing-getter-post' => 'Unbalanced XML handoff hook evidence',
        'resolution-depth' => 'Layout template resolution nesting exceeded 256 calls'][$mode] ?? null;
    if (!$expected || !str_contains($error->getMessage(), $expected)) throw $error;
    echo "Verified native template publication guard for $mode.\n";
    exit;
}
$events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
$template = array_values(array_filter($declarations, static fn($item) => $item['layout']['kind'] === 'template'))[0];
$effects = array_values(array_unique(array_column(array_filter($events,
    static fn($event) => $event['id'] === $template['id']), 'type')));
sort($effects);
$expected = in_array($mode, ['native', 'fallback', 'compiled-fallback', 'resolver-fallback', 'compiled-resolver-fallback'], true) ? ['layout-template-executed', 'layout-template-selected']
    : ['layout-template-origin-unconfirmed', 'layout-template-selected'];
if ($effects !== $expected) throw new RuntimeException('Equal runtime template replacement retained original execution ownership');
echo "Verified original template execution ownership for $mode.\n";
