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
use Magento\Framework\App\Area;
use Magento\Framework\View\Element\Template;
use Magento\Framework\View\Element\Template\File\Validator;

class RejectedTemplateValidator extends Validator
{
    public static int $calls = 0;
    public function isValid($filename)
    {
        self::$calls++;
        return false;
    }
}
class ParentTemplateValidator extends Validator
{
    public static int $calls = 0;
    public function isValid($filename)
    {
        parent::isValid($filename);
        self::$calls++;
        return false;
    }
}
$mode = $argv[1] ?? 'missing';
if (!in_array($mode, ['native', 'missing', 'unset-dependencies', 'override', 'parent-override',
    'missing-pre', 'missing-post', 'missing-both'], true)) throw new RuntimeException('Unknown template validation proof mode');
$missing = !in_array($mode, ['native', 'override', 'parent-override'], true);
$handle = $missing ? 'coverageprobe_renderfailure_missing' : 'coverageprobe_templateownership_native';
$name = $missing ? 'magelens.layout.renderfailure.missing' : 'magelens.layout.template.native';
$path = 'app/code/MageLens/Compatibility/view/frontend/layout/' . $handle . '.xml';
$source = file_get_contents(BP . '/' . $path);
$declarations = LayoutManifest::declarations($path, $source);
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets([
    ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source), 'declarations' => $declarations],
]));
foreach ($callbacks as [$class, $method, $pre, $post]) {
    if (in_array('--without-collector', $argv, true)) continue;
    if ($class === Validator::class && $method === 'isValid') {
        if ($mode === 'missing-both') continue;
        if ($mode === 'missing-pre') $pre = null;
        if ($mode === 'missing-post') $post = null;
    }
    if (!OpenTelemetry\Instrumentation\hook($class, $method, $pre, $post)) throw new RuntimeException('Cannot register template validation hook');
}
$nativeCalls = 0;
$pathCalls = 0;
if (!OpenTelemetry\Instrumentation\hook(Validator::class, 'isValid', null,
    static function ($validator, array $params, $result, ?Throwable $error, string $class) use (&$nativeCalls): void {
        if ($class === Validator::class) $nativeCalls++;
    })) throw new RuntimeException('Cannot register native validation counter');
if (!OpenTelemetry\Instrumentation\hook(Validator::class, 'isPathInDirectories', null,
    static function () use (&$pathCalls): void { $pathCalls++; })) throw new RuntimeException('Cannot register native validation cache counter');
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$state = $objects->get(Magento\Framework\App\State::class);
$state->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
$area->load(Area::PART_CONFIG);
$area->load(Area::PART_DESIGN);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$fragment = $objects->get(Magento\Framework\View\Result\LayoutFactory::class)->create();
$fragment->addHandle($handle);
$block = $fragment->getLayout()->getBlock($name);
$custom = ['override' => RejectedTemplateValidator::class, 'parent-override' => ParentTemplateValidator::class][$mode] ?? null;
if ($custom !== null) {
    $configuration = $objects->get(Magento\Framework\ObjectManager\ConfigInterface::class);
    if ($configuration instanceof Magento\Framework\ObjectManager\Config\Compiled) {
        // Test-defined subclasses are absent from compiled metadata. Reuse the
        // installed native constructor references without changing inheritance.
        $native = $configuration->getInstanceType($configuration->getPreference(Validator::class));
        $arguments = $configuration->getArguments($native);
        if (!is_array($arguments) || !$arguments) throw new RuntimeException('Native compiled validator constructor is unavailable');
        $names = array_fill_keys(array_map(static fn($parameter) => $parameter->getName(),
            (new ReflectionMethod($custom, '__construct'))->getParameters()), true);
        $configuration->extend(['arguments' => [$custom => array_intersect_key($arguments, $names)]]);
    }
    (new ReflectionProperty(Template::class, 'validator'))->setValue($block, $objects->create($custom));
}
if ($mode === 'unset-dependencies') Closure::bind(static function ($block): void {
    unset($block->templateContext, $block->templateEnginePool);
}, null, Template::class)($block);
$coldPathCalls = null;
for ($attempt = 0; $attempt < 2; $attempt++) {
    try {
        $html = $block->toHtml();
        if ($mode === 'native') {
            if (!str_contains($html, 'data-layout-mutation>xml-value</span>')) throw new RuntimeException('Native valid template output changed');
        } elseif ($state->getMode() === 'developer' || $html !== '') throw new RuntimeException('Rejected template did not take the native mode boundary');
    } catch (Magento\Framework\Exception\ValidatorException $error) {
        if ($mode === 'native' || $state->getMode() !== 'developer') throw $error;
    }
    if ($attempt === 0) $coldPathCalls = $pathCalls;
}
if ($pathCalls !== $coldPathCalls || ($mode === 'override' ? $pathCalls !== 0 : $pathCalls === 0)) {
    throw new RuntimeException('Native template validation cache was not reused');
}
if ($nativeCalls !== ($mode === 'override' ? 0 : 2) || ($custom !== null && $custom::$calls !== 2)) {
    throw new RuntimeException('Template validation call counts changed');
}
echo "Verified two native $mode validation outcomes in {$state->getMode()} mode, including repeated validation.\n";
if (in_array('--without-collector', $argv, true)) exit;
try {
    $collector->finish();
    if (in_array($mode, ['missing-pre', 'missing-post'], true)) throw new LogicException('Missing validation hook half was accepted');
} catch (RuntimeException $error) {
    if (!in_array($mode, ['missing-pre', 'missing-post'], true)
        || !str_contains($error->getMessage(), 'Unbalanced native template validation hook evidence')) throw $error;
    echo "Verified missing template validation hook half blocks publication.\n";
    exit;
}
$events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
$item = array_values(array_filter($declarations, static fn($item) => $item['layout']['kind'] === 'template'))[0];
$types = array_values(array_unique(array_column(array_filter($events, static fn($event) => $event['id'] === $item['id']), 'type')));
sort($types);
$expected = ['layout-template-selected'];
if ($mode === 'native') $expected[] = 'layout-template-executed';
else {
    if ($state->getMode() === 'developer') $expected[] = 'layout-template-failed';
    if (in_array($mode, ['missing', 'unset-dependencies'], true)) $expected[] = 'layout-template-validation-rejected';
    elseif ($state->getMode() !== 'developer') $expected[] = 'layout-template-origin-unconfirmed';
}
sort($expected);
if ($types !== $expected) throw new RuntimeException('Template validation evidence differs for ' . $mode . ': ' . implode(', ', $types));
$rejections = array_filter($events, static fn($event) => $event['id'] === $item['id'] && $event['type'] === 'layout-template-validation-rejected');
if ($rejections && array_sum(array_column($rejections, 'hits')) !== 2) throw new RuntimeException('Repeated rejection frequency differs');
echo "Verified attributable native validation decisions and opaque validator limitations.\n";
