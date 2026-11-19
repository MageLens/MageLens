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

use MageLens\XmlCoverage\{LayoutCoverage, LayoutManifest, LayoutRuntimeHooks, Recorder};
use Magento\Framework\DataObject;
use Magento\Framework\View\Element\Template;

class MageLensExternalReflectionProperty extends ReflectionProperty
{
    public static int $reads = 0;
    public function getName(): string { self::$reads++; return 'unrelated'; }
    public function getDeclaringClass(): ReflectionClass { self::$reads++; return new ReflectionClass(stdClass::class); }
}
class MageLensForeignReflectionTarget
{
    protected $_template;
    protected $_data;
}
class MageLensExternalReflectionWriter
{
    public static int $calls = 0;
    public static function write(Template $block, string $field, string $method, bool $failed): void
    {
        self::$calls++;
        $owner = $failed ? MageLensForeignReflectionTarget::class : ($field === '_template' ? Template::class : DataObject::class);
        $property = new MageLensExternalReflectionProperty($owner, $field);
        $value = $field === '_template' ? 'MageLens_Compatibility::layout-mutation.phtml' : ['value' => 'xml-value', 'late' => 'xml-value'];
        if ($failed) $value = $field === '_template' ? 'MageLens_Compatibility::missing-reflection.phtml' : ['value' => 'failed-write', 'late' => 'failed-write'];
        try {
            $property->$method($block, $value);
            if ($failed) throw new LogicException('Expected native reflection receiver rejection');
        } catch (ReflectionException|Error $error) {
            if (!$failed) throw $error;
        }
    }
}
$mode = $argv[1] ?? 'template';
if (!in_array($mode, ['template', 'data'], true)) throw new RuntimeException('Unknown native reflection field');
$methodIndex = array_search('--method', $argv, true);
$method = $methodIndex === false ? 'setRawValue' : $argv[$methodIndex + 1];
if (!in_array($method, ['setValue', 'setRawValue', 'setRawValueWithoutLazyInitialization'], true)) throw new RuntimeException('Unknown native reflection method');
$failed = in_array('--failed', $argv, true);
$duringGeneration = in_array('--during-generation', $argv, true);
$unmapped = in_array('--unmapped', $argv, true);
$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_packagemutation_' . ($unmapped ? 'unused' : 'native') . '.xml';
$source = file_get_contents(BP . '/' . $path);
$declarations = LayoutManifest::declarations($path, $source);
if ($unmapped) set_error_handler(static function (int $severity, string $message, string $file, int $line): never {
    throw new ErrorException($message, 0, $severity, $file, $line);
});
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets([
    ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source), 'declarations' => $declarations],
]));
if (!in_array('--without-collector', $argv, true)) foreach ($callbacks as [$class, $methodName, $pre, $post]) {
    if (!LayoutRuntimeHooks::register($class, $methodName, $pre, $post)) throw new RuntimeException('Cannot observe reflection field fixture');
}
if ($duringGeneration && !LayoutRuntimeHooks::register(Magento\Framework\View\Layout\Generator\Block::class, 'generateBlock', null,
    static function ($generator, array $params, $block, ?Throwable $error) use ($mode, $method, $failed): void {
        if (!$error && $block instanceof Template && ($params[2] ?? null) === 'magelens.layout.package.native') {
            MageLensExternalReflectionWriter::write($block, $mode === 'template' ? '_template' : '_data', $method, $failed);
        }
    })) throw new RuntimeException('Cannot schedule native reflection generation fixture');
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
foreach ([Magento\Framework\App\Area::PART_CONFIG, Magento\Framework\App\Area::PART_DESIGN] as $part) $area->load($part);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$objects->get(Magento\Framework\App\ViewInterface::class);
$page = $objects->get(Magento\Framework\View\Result\PageFactory::class)->create(true, ['isIsolated' => true]);
$page->addHandle('coverageprobe_packagemutation_native');
$layout = $page->getLayout();
$block = $layout->getBlock('magelens.layout.package.native');
if (!$duringGeneration) MageLensExternalReflectionWriter::write($block, $mode === 'template' ? '_template' : '_data', $method, $failed);
$html = $block->toHtml();
if (!str_contains($html, 'data-layout-mutation>xml-value</span>') || MageLensExternalReflectionWriter::$calls !== 1
    || MageLensExternalReflectionProperty::$reads !== 0 || hash_file('sha256', BP . '/' . $path) !== hash('sha256', $source)) {
    throw new RuntimeException('Native reflection output, call counts, passive metadata or XML bytes changed: writes=' . MageLensExternalReflectionWriter::$calls . '; metadata reads=' . MageLensExternalReflectionProperty::$reads . '; output=' . (int)str_contains($html, 'data-layout-mutation>xml-value</span>'));
}
echo 'Verified native external reflection ', $failed ? 'rejection' : 'write', ', unchanged output and zero application metadata getter calls.', "\n";
if (in_array('--without-collector', $argv, true)) exit;
$state = $collector->finish();
$events = array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue());
if ($unmapped) {
    if ($events) throw new RuntimeException('Reflection on an unmapped block inferred original source hits');
    echo "Verified healthy zero-hit original inventory for an unmapped reflected block.\n";
    exit;
}

$kind = $mode === 'template' ? 'template' : 'argument';
$declaration = array_values(array_filter($declarations, static fn($item) => $item['layout']['kind'] === $kind
    && ($kind === 'template' || $item['layout']['element'] === 'value')))[0];
$effects = array_column(array_filter($events, static fn($event) => $event['id'] === $declaration['id']), 'type');
$consumed = $mode === 'template' ? 'layout-template-executed' : 'layout-argument-read';
$replaced = $mode === 'template' ? 'layout-template-replaced' : 'layout-argument-replaced';
if (in_array($consumed, $effects, true) !== $failed || in_array($replaced, $effects, true) === $failed) {
    throw new RuntimeException('External reflection retained original XML ownership or revoked it after a failed write: ' . implode(', ', $effects));
}
$independentKind = $mode === 'template' ? 'argument' : 'template';
$independent = array_values(array_filter($declarations, static fn($item) => $item['layout']['kind'] === $independentKind
    && ($independentKind === 'template' || $item['layout']['element'] === 'value')))[0];
$independentEffects = array_column(array_filter($events, static fn($event) => $event['id'] === $independent['id']), 'type');
if (!in_array($mode === 'template' ? 'layout-argument-read' : 'layout-template-executed', $independentEffects, true)) {
    throw new RuntimeException('Reflection write erased an independent surviving XML origin');
}
echo "Verified external reflection effects retain only surviving original XML ownership.\n";
$destination = array_search('--evidence-file', $argv, true);
if ($destination !== false) {
    $files = [['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source), 'declarations' => $declarations]];
    $json = json_encode(['files' => $files, 'layoutSources' => LayoutManifest::targets($files), 'layoutHook' => $state[0],
        'layoutSourceTrace' => $state[1], 'layoutLimitations' => $state[2], 'events' => $events], JSON_THROW_ON_ERROR);
    if (file_put_contents($argv[$destination + 1], $json) !== strlen($json)) throw new RuntimeException('Cannot save bounded reflection evidence');
}
