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
    'missing-plugin-lookup', 'engine', 'engine-inherited', 'engine-fallback', 'compiled-engine-fallback',
    'engine-plugin', 'compiled-engine-plugin', 'engine-around', 'compiled-engine-around', 'missing-engine',
    'missing-engine-pre', 'missing-engine-post', 'missing-engine-wrapper', 'missing-engine-plugin',
    'missing-engine-lookup', 'missing-engine-pool', 'rendering-depth', 'before-plugin-depth',
    'engine-inherited-fallback'], true)) throw new RuntimeException('Unknown template proof mode');
$case = in_array($mode, ['getter', 'file', 'resolver', 'engine'], true) ? $mode : 'native';
$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_templateownership_' . $case . '.xml';
$source = file_get_contents(BP . '/' . $path);
$declarations = LayoutManifest::declarations($path, $source);
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets([
    ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source), 'declarations' => $declarations],
]));
$resolverOwnership = (new ReflectionProperty(LayoutCoverage::class, 'templateOwnership'))->getValue($collector);
$resolverPlugin = (new ReflectionProperty(\MageLens\XmlCoverage\LayoutTemplateOwnership::class, 'beforePlugin'))->getValue($resolverOwnership);
$enginePlugin = (new ReflectionProperty(LayoutCoverage::class, 'engineBeforePlugin'))->getValue($collector);
foreach ($callbacks as [$class, $method, $pre, $post]) {
    $missing = ['missing-getter' => [Template::class, 'getTemplate'], 'missing-file' => [Template::class, 'getTemplateFile'],
        'missing-resolver' => [Template\File\Resolver::class, 'getTemplateFileName']][$mode] ?? null;
    if ($missing === [$class, $method]) continue;
    if ($mode === 'missing-theme-plugin' && $class === \Magento\ProductAlert\Model\UpdateThemeParams::class) continue;
    if ($class === \Magento\Framework\Interception\PluginListInterface::class && $method === 'getPlugin' && $post instanceof Closure) {
        $owner = (new ReflectionFunction($post))->getClosureThis();
        if (($mode === 'missing-plugin-lookup' && $owner === $resolverPlugin)
            || ($mode === 'missing-engine-lookup' && $owner === $enginePlugin)) continue;
    }
    if ($mode === 'missing-engine-plugin' && $class === 'Hyva\\Theme\\Plugin\\TemplateEngine\\PhpPlugin') continue;
    if ($mode === 'missing-engine-pool' && $class === \Magento\Framework\View\TemplateEnginePool::class) continue;
    if ($class === \Magento\Framework\View\TemplateEngine\Php::class && $method === 'render') {
        if ($mode === 'missing-engine') continue;
        if ($mode === 'missing-engine-pre') $pre = null;
        if ($mode === 'missing-engine-post') $post = null;
    }
    if ($class === Template::class && $method === 'getTemplate') {
        if ($mode === 'missing-getter-pre') $pre = null;
        if ($mode === 'missing-getter-post') $post = null;
    }
    if (!\OpenTelemetry\Instrumentation\hook($class, $method, $pre, $post)) throw new RuntimeException('Cannot register template proof hook');
}
$objects = \Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(\Magento\Framework\App\State::class)->setAreaCode('frontend');
$objects->get(\Magento\Framework\App\AreaList::class)->getArea('frontend')->load(\Magento\Framework\App\Area::PART_CONFIG);
$objects->get(\Magento\Framework\App\AreaList::class)->getArea('frontend')->load(\Magento\Framework\App\Area::PART_DESIGN);
$plugin = match ($mode) {
    'getter-plugin', 'compiled-getter-plugin' => \MageLens\Compatibility\Model\LayoutTemplateGetterPlugin::class,
    'file-plugin', 'compiled-file-plugin' => \MageLens\Compatibility\Model\LayoutTemplateFilePlugin::class,
    'resolver-plugin', 'compiled-resolver-plugin' => \MageLens\Compatibility\Model\LayoutTemplateResolverPlugin::class,
    'around', 'compiled-around' => \MageLens\Compatibility\Model\LayoutTemplateAround::class,
    'engine-plugin', 'compiled-engine-plugin' => \MageLens\Compatibility\Model\LayoutEngineBefore::class,
    'engine-around', 'compiled-engine-around' => \MageLens\Compatibility\Model\LayoutEngineAround::class,
    default => null,
};
if ($mode === 'custom-theme-plugin') {
    $objects->configure(['preferences' => [\Magento\ProductAlert\Model\UpdateThemeParams::class => \MageLens\Compatibility\Model\LayoutTemplateBefore::class]]);
}
$engineWrapper = str_contains($mode, 'engine-') && in_array($mode, ['engine-fallback', 'compiled-engine-fallback', 'engine-plugin',
    'compiled-engine-plugin', 'engine-around', 'compiled-engine-around', 'missing-engine-wrapper', 'missing-engine-lookup', 'engine-inherited-fallback'], true);
if ($plugin !== null || $engineWrapper || in_array($mode, ['fallback', 'compiled-fallback', 'resolver-fallback', 'compiled-resolver-fallback', 'missing-plugin-lookup'], true)) {
    $native = $engineWrapper ? \Magento\Framework\View\TemplateEngine\Php::class
        : (str_contains($mode, 'resolver-') || $mode === 'missing-plugin-lookup' ? Template\File\Resolver::class : Template::class);
    if ($mode === 'engine-inherited-fallback') $native = \MageLens\Compatibility\Model\LayoutEngineInherited::class;
    layoutNativeInterceptor($objects, $native,
        $plugin, str_starts_with($mode, 'compiled-'));
}
if ($mode === 'missing-engine-wrapper') {
    $ownership = (new ReflectionProperty(LayoutCoverage::class, 'ownership'))->getValue($collector);
    (new ReflectionProperty(\MageLens\XmlCoverage\LayoutXmlOwnership::class, 'watched'))->setValue($ownership,
        [\Magento\Framework\View\TemplateEngine\Php::class . '\\Interceptor::render' => true]);
}
if ($mode === 'rendering-depth') {
    (new ReflectionProperty(LayoutCoverage::class, 'fetching'))->setValue($collector, array_fill(0, 256, []));
}
if ($mode === 'before-plugin-depth') {
    $before = (new ReflectionProperty(LayoutCoverage::class, 'engineBeforePlugin'))->getValue($collector);
    (new ReflectionProperty(\MageLens\XmlCoverage\LayoutBeforePluginOwnership::class, 'calls'))->setValue($before,
        array_fill(0, 256, ['object' => new stdClass()]));
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
if ($case === 'engine' || in_array($mode, ['engine-inherited', 'engine-inherited-fallback'], true)) {
    $property = new ReflectionProperty(Template::class, 'templateEnginePool');
    $pool = clone $property->getValue($block);
    (new ReflectionProperty(\Magento\Framework\View\TemplateEnginePool::class, 'engines'))->setValue($pool,
        ['phtml' => $objects->create($case !== 'engine' ? \MageLens\Compatibility\Model\LayoutEngineInherited::class
            : \MageLens\Compatibility\Model\LayoutTemplateEngine::class)]);
    $property->setValue($block, $pool);
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
    if (str_starts_with($mode, 'missing-') || in_array($mode, ['resolution-depth', 'rendering-depth', 'before-plugin-depth'], true)) throw new LogicException('Missing template observation was accepted');
} catch (RuntimeException $error) {
    $expected = ['missing-getter' => 'Missing native template getter hook evidence',
        'missing-file' => 'Missing native template file getter hook evidence',
        'missing-resolver' => 'Missing native template resolver hook evidence',
        'missing-theme-plugin' => 'Missing native template theme parameter hook evidence',
        'missing-plugin-lookup' => 'Missing native template resolver plugin lookup hook evidence',
        'missing-engine' => 'Missing native template engine hook evidence',
        'missing-engine-pre' => 'Unbalanced layout producer hook evidence',
        'missing-engine-post' => 'Unbalanced XML handoff hook evidence',
        'missing-engine-wrapper' => 'Missing generated template engine hook evidence',
        'missing-engine-plugin' => 'Missing native template engine before-plugin hook evidence',
        'missing-engine-lookup' => 'Missing native template engine plugin lookup hook evidence',
        'missing-engine-pool' => 'Missing native template engine pool hook evidence',
        'rendering-depth' => 'Layout template rendering nesting exceeded 256 calls',
        'before-plugin-depth' => 'Layout before-plugin nesting exceeded 256 calls',
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
$expected = in_array($mode, ['native', 'fallback', 'compiled-fallback', 'resolver-fallback', 'compiled-resolver-fallback',
    'engine-inherited', 'engine-inherited-fallback', 'engine-fallback', 'compiled-engine-fallback'], true) ? ['layout-template-executed', 'layout-template-selected']
    : ['layout-template-origin-unconfirmed', 'layout-template-selected'];
if ($effects !== $expected) throw new RuntimeException('Equal runtime template replacement retained original execution ownership');
echo "Verified original template execution ownership for $mode.\n";
