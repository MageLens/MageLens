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
    if ($class === Composite::class && $method === 'getInterpreter') {
        if (in_array('--missing-dispatch-pre', $argv, true)) $pre = null;
        if (in_array('--missing-dispatch-post', $argv, true)) $post = null;
    }
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
$forwarder = in_array('--custom-forwarder', $argv, true);
$custom = in_array('--custom-dispatch', $argv, true);
$alternate = in_array('--alternate-discriminator', $argv, true);
if ($custom || $alternate || $forwarder) {
    class MageLensArgumentFieldDispatch extends Composite
    {
        public static int $calls = 0;
        protected function getInterpreter($name)
        {
            self::$calls++;
            return parent::getInterpreter($name);
        }
    }
    class MageLensArgumentFieldForwarder implements InterpreterInterface
    {
        public static int $calls = 0;
        public function __construct(private InterpreterInterface $delegate) {}
        public function evaluate(array $data)
        {
            self::$calls++;
            return $this->delegate->evaluate($data);
        }
    }
    $original = $objects->get('layoutArgumentReaderInterpreter');
    $interpreters = (new ReflectionProperty(Composite::class, 'interpreters'))->getValue($original);
    if ($alternate) {
        $byName = [];
        $document = new DOMDocument(); $document->loadXML(file_get_contents(BP . '/' . $files[0]['path']));
        foreach ((new DOMXPath($document))->query('/page/body/referenceContainer/block/arguments/argument') as $argument) {
            $byName[$argument->getAttribute('name')] = $interpreters[$argument->getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'type')];
        }
        $replacement = new Composite($byName, 'name');
    } else $replacement = $forwarder ? new MageLensArgumentFieldForwarder($original)
        : new MageLensArgumentFieldDispatch($interpreters, 'xsi:type');
    $saved = [];
    $property = new ReflectionProperty(Magento\Framework\View\Layout\Reader\Block::class, 'argumentInterpreter');
    OpenTelemetry\Instrumentation\hook(Magento\Framework\View\Layout\Reader\Block::class, 'evaluateArguments',
        static function ($reader, array $params) use ($replacement, $property, &$saved): void {
            $replace = $params[0]->getAttribute('name') === 'magelens.layout.arguments';
            $saved[] = $replace ? $property->getValue($reader) : null;
            if ($replace) $property->setValue($reader, $replacement);
        }, static function ($reader) use ($property, &$saved): void {
            $original = array_pop($saved);
            if ($original !== null) $property->setValue($reader, $original);
        });
}
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
if ($forwarder && MageLensArgumentFieldForwarder::$calls === 0) throw new RuntimeException('Custom interpreter forwarding was bypassed');
if ($custom && MageLensArgumentFieldDispatch::$calls === 0) throw new RuntimeException('Custom type selector was bypassed');
if (in_array('--without-collector', $argv, true)) exit;
$missing = in_array('--missing-dispatch-pre', $argv, true) || in_array('--missing-dispatch-post', $argv, true);
try { $state = $collector->finish(); }
catch (RuntimeException $error) {
    if (!$missing || !str_contains($error->getMessage(), 'Missing native layout argument type dispatch hook evidence')) throw $error;
    echo "Verified missing type dispatch evidence rejects publication after unchanged native values.\n";
    exit;
}
if ($missing) throw new RuntimeException('Missing original type dispatch observation was accepted');
$events = array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue());
foreach (range(1, 25) as $position) {
    $node = '/page/body/referenceContainer/block/arguments/argument[' . $position . ']/@xsi:type';
    $declarations = array_values(array_filter($files[0]['declarations'], static fn($item) => $item['node'] === $node));
    if (count($declarations) !== 1) throw new RuntimeException('Original type operand is missing');
    $types = array_column(array_filter($events, static fn($event) => $event['id'] === $declarations[0]['id']), 'type');
    $replaced = ($custom || $forwarder) ? $position !== 13
        : ($alternate && !in_array($position, [6, 7, 8, 9, 10, 11, 12, 13, 23], true));
    if (in_array('layout-argument-type-evaluated', $types, true) === $replaced
        || ($replaced && !in_array('layout-argument-type-origin-unconfirmed', $types, true))) {
        throw new RuntimeException('Original type operand differs from its native consumer boundary at position ' . $position);
    }
}
echo "Verified original type operands at their native interpretation boundary.\n";
$evidencePath = array_search('--evidence-file', $argv, true);
if ($evidencePath !== false) {
    $encoded = json_encode(['files' => $files, 'layoutSources' => LayoutManifest::targets($files),
        'layoutHook' => $state[0], 'layoutSourceTrace' => $state[1], 'layoutLimitations' => $state[2],
        'events' => $events], JSON_THROW_ON_ERROR);
    if (file_put_contents($argv[$evidencePath + 1], $encoded) !== strlen($encoded)) throw new RuntimeException('Cannot write bounded argument field evidence');
    echo "Wrote bounded original-source proof evidence without raw argument values.\n";
}
