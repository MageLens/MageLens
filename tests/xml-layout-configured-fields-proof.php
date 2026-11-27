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

use MageLens\Compatibility\Model\LayoutConfiguredData;
use MageLens\XmlCoverage\{LayoutCoverage, LayoutManifest, LayoutRuntimeHooks, Recorder};
use Magento\Framework\View\Element\UiComponent\Argument\Interpreter\ConfigurableObject;
use Magento\Framework\ObjectManagerInterface;

$action = in_array('--action', $argv, true);
$failure = in_array('--nested-failure', $argv, true);
$missingCreate = in_array('--missing-create', $argv, true);
$handle = $action ? 'coverageprobe_layout_arguments'
    : ($failure ? 'coverageprobe_grammar_configuredarray' : 'coverageprobe_grammar_configureddata');
$className = $action ? MageLens\Compatibility\Model\LayoutArgumentSource::class : LayoutConfiguredData::class;
$path = 'app/code/MageLens/Compatibility/view/frontend/layout/' . $handle . '.xml';
$source = file_get_contents(BP . '/' . $path);
$files = [['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
    'declarations' => LayoutManifest::declarations($path, $source)]];
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
if (!in_array('--without-collector', $argv, true)) foreach ($callbacks as [$class, $method, $pre, $post]) {
    if ($missingCreate && $class === ObjectManagerInterface::class && $method === 'create' && $pre === null) continue;
    if (!LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot observe configured value fixture');
}
$deliveries = [];
if (!LayoutRuntimeHooks::register(Magento\Framework\ObjectManagerInterface::class, 'create', null,
    static function ($manager, array $params, $result, ?Throwable $error) use (&$deliveries, $className): void {
        if (($params[0] ?? null) !== $className) return;
        $trace = LayoutRuntimeHooks::trace(DEBUG_BACKTRACE_IGNORE_ARGS, 4);
        if (($trace[2]['class'] ?? null) !== ConfigurableObject::class || ($trace[2]['function'] ?? null) !== 'evaluate') return;
        $deliveries[] = [!$error && $result instanceof $className, $params[1] ?? null];
    })) throw new RuntimeException('Cannot observe native configured constructor handoff');
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
foreach ([Magento\Framework\App\Area::PART_CONFIG, Magento\Framework\App\Area::PART_DESIGN, Magento\Framework\App\Area::PART_TRANSLATE] as $part) $area->load($part);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$objects->get(Magento\Framework\App\ViewInterface::class);
$page = $objects->get(Magento\Framework\View\Result\PageFactory::class)->create(!$action, ['isIsolated' => true]);
$page->addHandle($handle);
if ($action) {
    $page->getConfig()->setPageLayout('magelens_fixture');
    $page->addHandle('coverageprobe_layout_arguments_overlay');
}
$layout = $page->getLayout();
if ($failure) {
    try {
        $layout->getBlock('magelens.layout.grammar.configuredarray');
        throw new RuntimeException('Native nested configured layout should fail before construction');
    } catch (TypeError $error) {
        if (!str_starts_with($error->getMessage(), 'Magento\Framework\Data\Argument\Interpreter\Composite::evaluate(): Argument #1 ($data) must be of type array, string given')) throw $error;
    }
    if ($deliveries) throw new RuntimeException('Unexpected nested configured construction');
    echo "Verified the native parser shape blocks configured construction under an array item.\n";
} elseif ($action) {
    $block = $layout->getBlock('magelens.layout.arguments');
    $html = $block->toHtml();
    if ($deliveries !== [[true, []]] || substr_count($html, '>verified</span>') !== 23 || str_contains($html, '>unexpected</span>')) {
        throw new RuntimeException('Native configured action delivery or output changed');
    }
    echo "Verified one native configured class passed to the original action.\n";
} else {
    $block = $layout->getBlock('magelens.layout.grammar.configureddata');
    $value = $block->getData('value');
    if ($deliveries !== [[true, ['data' => ['tag' => 'configured-data']]]]
        || !$value instanceof LayoutConfiguredData || $value->getData('tag') !== 'configured-data') {
        throw new RuntimeException('Native configured class, constructor map or supplied block value changed');
    }
    echo "Verified one native configured class selection, constructor argument map and supplied block value.\n";
}
if ($source !== file_get_contents(BP . '/' . $path)) throw new RuntimeException('Original configured layout source changed');
if (in_array('--without-collector', $argv, true)) exit;
try {
    $collector->finish();
    if ($missingCreate) throw new LogicException('Missing configured construction did not block publication');
} catch (RuntimeException $error) {
    if (!$missingCreate || !str_contains($error->getMessage(), 'Missing native configurable object argument or construction hook evidence')) throw $error;
    echo "Verified missing native construction evidence rejects publication after unchanged native values.\n";
    exit;
}
$events = array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue());
$expected = [
    '/page/body/block/arguments/argument/argument[1]' => ['layout-configured-argument-evaluated', 'layout-configured-class-selected'],
    '/page/body/block/arguments/argument/argument[1]/@name' => ['layout-configured-class-selected'],
    '/page/body/block/arguments/argument/argument[1]/@xsi:type' => ['layout-argument-type-evaluated'],
    '/page/body/block/arguments/argument/argument[2]' => ['layout-configured-argument-evaluated', 'layout-configured-argument-supplied'],
    '/page/body/block/arguments/argument/argument[2]/@name' => ['layout-configured-argument-supplied'],
    '/page/body/block/arguments/argument/argument[2]/@xsi:type' => ['layout-argument-type-evaluated'],
    '/page/body/block/arguments/argument/argument[2]/item' => ['layout-configured-item-evaluated'],
    '/page/body/block/arguments/argument/argument[2]/item/@name' => ['layout-configured-item-name-applied'],
    '/page/body/block/arguments/argument/argument[2]/item/@xsi:type' => ['layout-argument-type-evaluated'],
];
if ($action) {
    $base = '/page/body/referenceContainer/block/action[3]/argument/argument';
    $expected = [
        $base => ['layout-configured-argument-evaluated', 'layout-configured-class-selected'],
        $base . '/@name' => ['layout-configured-class-selected'],
        $base . '/@xsi:type' => ['layout-argument-type-evaluated'],
    ];
} elseif ($failure) {
    $base = '/page/body/block/arguments/argument/item/argument';
    $expected = [$base => [], $base . '/@name' => [], $base . '/@xsi:type' => []];
    foreach ($files[0]['declarations'] as $declaration) {
        if (!isset($expected[$declaration['node']])) continue;
        if ($declaration['supported'] || !str_contains($declaration['reason'], 'parser does not key')) {
            throw new RuntimeException('Native nested parser limitation is missing');
        }
    }
}
foreach ($files[0]['declarations'] as $declaration) {
    $node = $declaration['node'];
    if (!isset($expected[$node])) continue;
    $actual = array_values(array_unique(array_column(array_filter($events, static fn($record) => $record['id'] === $declaration['id']), 'type')));
    if ($actual !== $expected[$node]) throw new RuntimeException('Missing configured child evidence at ' . $node . ': ' . implode(', ', $actual));
    unset($expected[$node]);
}
if ($expected) throw new RuntimeException('Configured child source inventory changed');
echo "Verified original nested values, names, type dispatch and native object manager handoff.\n";
