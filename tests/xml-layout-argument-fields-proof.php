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
use Magento\Framework\Data\Argument\Interpreter\Composite;
use Magento\Framework\Data\Argument\InterpreterInterface;

$files = [];
foreach (['coverageprobe_layout_arguments.xml', 'coverageprobe_layout_arguments_overlay.xml'] as $name) {
    $path = 'app/code/MageLens/Compatibility/view/frontend/layout/' . $name;
    $source = file_get_contents(BP . '/' . $path);
    $files[] = ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
        'declarations' => LayoutManifest::declarations($path, $source)];
}
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
if (!in_array('--without-collector', $argv, true)) foreach ($callbacks as [$class, $method, $pre, $post]) {
    if (!LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot register argument field proof');
}
$selected = [];
OpenTelemetry\Instrumentation\hook(Composite::class, 'getInterpreter', null,
    static function ($composite, array $params, $interpreter, ?Throwable $error) use (&$selected): void {
        if (!$error && $interpreter instanceof InterpreterInterface) $selected[$params[0]] = true;
    });
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
foreach ([Magento\Framework\App\Area::PART_CONFIG, Magento\Framework\App\Area::PART_DESIGN,
    Magento\Framework\App\Area::PART_TRANSLATE] as $part) $area->load($part);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$objects->get(Magento\Framework\App\ViewInterface::class);
$page = $objects->get(Magento\Framework\View\Result\PageFactory::class)->create(false, ['isIsolated' => true]);
$page->getConfig()->setPageLayout('magelens_fixture');
$page->addHandle('coverageprobe_layout_arguments');
$page->addHandle('coverageprobe_layout_arguments_overlay');
$block = $page->getLayout()->getBlock('magelens.layout.arguments');
$html = $block->toHtml();
if (substr_count($html, '>verified</span>') !== 23 || str_contains($html, '>unexpected</span>')) {
    throw new RuntimeException('Native typed values, modifiers, overlays or action calls changed');
}
foreach (['string', 'number', 'boolean', 'null', 'array', 'object', 'options', 'helper', 'url', 'configurableObject'] as $type) {
    if (!isset($selected[$type])) throw new RuntimeException('Native type dispatch was not observed');
}
echo "Verified native typed values, nested overlays, shared/fresh identities, translation, options, helper/URL parameters and action dispatch.\n";
if (in_array('--without-collector', $argv, true)) exit;
$collector->finish();
$events = array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue());
foreach ([1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 18] as $position) {
    $node = '/page/body/referenceContainer/block/arguments/argument[' . $position . ']/@xsi:type';
    $declarations = array_values(array_filter($files[0]['declarations'], static fn($item) => $item['node'] === $node));
    if (count($declarations) !== 1) throw new RuntimeException('Original type operand is missing');
    $types = array_column(array_filter($events, static fn($event) => $event['id'] === $declarations[0]['id']), 'type');
    if (!in_array('layout-argument-type-evaluated', $types, true)) throw new RuntimeException('Original type operand lacks native consumer evidence');
}
echo "Verified original type operands at their native interpretation boundary.\n";
