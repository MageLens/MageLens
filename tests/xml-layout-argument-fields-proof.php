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

function finishArgumentFields(LayoutCoverage $collector, array $arguments): array
{
    $missing = (bool) array_intersect($arguments, ['--missing-dispatch-pre', '--missing-dispatch-post',
        '--missing-first-dispatch-pre', '--missing-first-dispatch-post',
        '--missing-native-first-pre', '--missing-native-first-post', '--missing-items-pre', '--missing-items-post',
        '--missing-modifier-pre', '--missing-modifier-post', '--missing-modifier-both',
        '--missing-action-dispatch-pre', '--missing-action-dispatch-post', '--missing-action-dispatch-both']);
    try { $state = $collector->finish(); }
    catch (RuntimeException $error) {
        if (!$missing || (!str_contains($error->getMessage(), 'Missing native layout argument type dispatch hook evidence')
            && !str_contains($error->getMessage(), 'Missing native layout array item traversal hook evidence')
            && !str_contains($error->getMessage(), 'Missing native layout argument interpreter entry hook evidence')
            && !str_contains($error->getMessage(), 'Missing native layout argument interpreter hook evidence'))) throw $error;
        echo "Verified missing type dispatch evidence rejects publication after unchanged native values.\n";
        exit;
    }
    if ($missing) throw new RuntimeException('Missing original type dispatch observation was accepted');
    return $state;
}
$firstLayout = in_array('--first-layout', $argv, true);
$serviceUrl = in_array('--service-url', $argv, true);
if (!$firstLayout && array_intersect($argv, ['--foreign-lookup', '--missing-first-dispatch-pre',
    '--missing-first-dispatch-post', '--missing-native-first-pre', '--missing-native-first-post'])) {
    throw new InvalidArgumentException('First-layout controls require --first-layout');
}
$files = [];
foreach ($serviceUrl ? ['coverageprobe_grammar_serviceurl.xml'] : ($firstLayout ? ['coverageprobe_argumentownership_native.xml']
    : ['coverageprobe_layout_arguments.xml', 'coverageprobe_layout_arguments_overlay.xml']) as $name) {
    $path = 'app/code/MageLens/Compatibility/view/frontend/layout/' . $name;
    $source = file_get_contents(BP . '/' . $path);
    $files[] = ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
        'declarations' => LayoutManifest::declarations($path, $source)];
}
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
$actionTypeIds = [];
foreach ($files as $file) foreach ($file['declarations'] as $declaration) {
    if ($declaration['layout']['attribute'] === 'xsi:type' && str_contains($declaration['node'], '/action[')) {
        $actionTypeIds[$declaration['id']] = true;
    }
}
$inForeignLookup = false;
$foreignObserved = 0;
if (!in_array('--without-collector', $argv, true)) foreach ($callbacks as [$class, $method, $pre, $post]) {
    if ($class === InterpreterInterface::class && $method === 'evaluate') {
        foreach (['pre', 'post'] as $half) {
            if (!in_array('--missing-modifier-' . $half, $argv, true) && !in_array('--missing-modifier-both', $argv, true)) continue;
            $observe = ${$half};
            ${$half} = static function (...$arguments) use ($observe, $collector): void {
                $ownership = (new ReflectionProperty($collector, 'argumentOwnership'))->getValue($collector);
                $frames = (new ReflectionProperty($ownership, 'evaluating'))->getValue($ownership);
                $frame = $frames[array_key_last($frames)] ?? null;
                $omit = $arguments[0] instanceof Magento\Framework\Data\Argument\Interpreter\StringUtils
                    && isset($frame?->type['fields']['translate']);
                if (!$omit) $observe(...$arguments);
            };
        }
    }
    if ($class === Magento\Framework\ObjectManager\Helper\SortItems::class && $method === 'sortItems') {
        if (in_array('--missing-items-pre', $argv, true)) $pre = null;
        if (in_array('--missing-items-post', $argv, true)) $post = null;
    }
    if ($class === Composite::class && $method === 'getInterpreter') {
        foreach (['pre', 'post'] as $half) {
            if (!in_array('--missing-action-dispatch-' . $half, $argv, true)
                && !in_array('--missing-action-dispatch-both', $argv, true)) continue;
            $observe = ${$half};
            ${$half} = static function (...$arguments) use ($collector, $actionTypeIds, $observe): void {
                $ownership = (new ReflectionProperty($collector, 'argumentOwnership'))->getValue($collector);
                $frames = (new ReflectionProperty($ownership, 'evaluating'))->getValue($ownership);
                $frame = $frames[array_key_last($frames)] ?? null;
                if (!isset($actionTypeIds[$frame?->type['id'] ?? ''])) $observe(...$arguments);
            };
        }
        if (in_array('--missing-dispatch-pre', $argv, true)) $pre = null;
        if (in_array('--missing-dispatch-post', $argv, true)) $post = null;
        foreach (['pre', 'post'] as $half) {
            $nativeOnly = in_array('--missing-native-first-' . $half, $argv, true);
            if (!$nativeOnly && !in_array('--missing-first-dispatch-' . $half, $argv, true)) continue;
            $observe = ${$half};
            $id = array_values(array_filter($files[0]['declarations'], static fn($item) =>
                $item['node'] === '/page/body/block/arguments/argument[1]/@xsi:type'))[0]['id'];
            ${$half} = static function (...$arguments) use ($collector, $id, $observe, $nativeOnly, &$inForeignLookup): void {
                $ownership = (new ReflectionProperty($collector, 'argumentOwnership'))->getValue($collector);
                $frames = (new ReflectionProperty($ownership, 'evaluating'))->getValue($ownership);
                $frame = $frames[array_key_last($frames)] ?? null;
                $batches = (new ReflectionProperty($ownership, 'batches'))->getValue($ownership);
                $reader = $batches[$frame?->batch ?? -1]['reader'] ?? false;
                if (($frame?->type['id'] ?? null) !== $id || ($nativeOnly && (!$reader || $inForeignLookup))) $observe(...$arguments);
            };
        }
    }
    if (!LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot register argument field proof');
}
$customItems = in_array('--custom-items', $argv, true);
if ($customItems) {
    class MageLensArgumentItemSorter extends Magento\Framework\ObjectManager\Helper\SortItems
    {
        public static int $calls = 0;
        public function sortItems(array $items): array { self::$calls++; return parent::sortItems($items); }
    }
    $property = new ReflectionProperty(Magento\Framework\Data\Argument\Interpreter\ArrayType::class, 'sortItemsHelper');
    $sorters = [];
    OpenTelemetry\Instrumentation\hook(InterpreterInterface::class, 'evaluate',
        static function ($interpreter) use ($property, &$sorters): void {
            if (!$interpreter instanceof Magento\Framework\Data\Argument\Interpreter\ArrayType) return;
            (new ReflectionClass($interpreter))->initializeLazyObject($interpreter);
            $sorters[] = $property->getValue($interpreter);
            $property->setValue($interpreter, new MageLensArgumentItemSorter());
        }, static function ($interpreter) use ($property, &$sorters): void {
            if (!$interpreter instanceof Magento\Framework\Data\Argument\Interpreter\ArrayType) return;
            $property->setValue($interpreter, array_pop($sorters));
        });
}
$selected = [];
$actionTypes = [];
$actionTypeProof = in_array('--action-types', $argv, true);
OpenTelemetry\Instrumentation\hook(Composite::class, 'getInterpreter', null,
    static function ($composite, array $params, $interpreter, ?Throwable $error) use (&$selected, &$inForeignLookup, &$foreignObserved, &$actionTypes, $actionTypeProof): void {
        if (!$error && $interpreter instanceof InterpreterInterface) $selected[$params[0]] = true;
        if ($actionTypeProof && !$error && $interpreter instanceof InterpreterInterface) {
            $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 6);
            if (($trace[3]['class'] ?? null) === Magento\Framework\View\Layout\Argument\Interpreter\Decorator\Updater::class
                && ($trace[3]['function'] ?? null) === 'evaluate'
                && ($trace[4]['class'] ?? null) === Magento\Framework\View\Layout\Generator\Block::class
                && ($trace[4]['function'] ?? null) === 'evaluateArguments'
                && ($trace[5]['function'] ?? null) === 'generateAction') $actionTypes[] = $params[0];
        }
        if ($inForeignLookup) $foreignObserved++;
    });
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
foreach ([Magento\Framework\App\Area::PART_CONFIG, Magento\Framework\App\Area::PART_DESIGN,
    Magento\Framework\App\Area::PART_TRANSLATE] as $part) $area->load($part);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$objects->get(Magento\Framework\App\ViewInterface::class);
$initializations = 0;
$nativeInitialization = false;
$foreignLookup = in_array('--foreign-lookup', $argv, true);
if ($firstLayout && $foreignLookup) {
    $original = $objects->get('layoutArgumentReaderInterpreter');
    $reflection = new ReflectionClass(Composite::class);
    $reflection->initializeLazyObject($original);
    $interpreters = (new ReflectionProperty(Composite::class, 'interpreters'))->getRawValue($original);
    $selector = new ReflectionMethod(Composite::class, 'getInterpreter');
    $replacement = $reflection->newLazyGhost(static function ($composite) use ($interpreters, $selector, &$initializations, &$nativeInitialization, &$inForeignLookup): void {
        $initializations++;
        $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 2)[1] ?? [];
        $nativeInitialization = ($caller['class'] ?? null) === Composite::class && ($caller['function'] ?? null) === 'evaluate';
        $composite->__construct($interpreters, 'xsi:type');
        $inForeignLookup = true;
        try { $selector->invoke($composite, 'helper'); } finally { $inForeignLookup = false; }
    });
    $property = new ReflectionProperty(Magento\Framework\View\Layout\Reader\Block::class, 'argumentInterpreter');
    $saved = [];
    OpenTelemetry\Instrumentation\hook(Magento\Framework\View\Layout\Reader\Block::class, 'evaluateArguments',
        static function ($reader, array $params) use ($replacement, $property, &$saved): void {
            $replace = $params[0]->getAttribute('name') === 'magelens.layout.argument.native';
            $saved[] = $replace ? $property->getValue($reader) : null;
            if ($replace) $property->setValue($reader, $replacement);
        }, static function ($reader) use ($property, &$saved): void {
            $original = array_pop($saved);
            if ($original !== null) $property->setValue($reader, $original);
        });
}
if ($serviceUrl) {
    $page = $objects->get(Magento\Framework\View\Result\PageFactory::class)->create(true, ['isIsolated' => true]);
    $page->addHandle('coverageprobe_grammar_serviceurl');
    $value = $page->getLayout()->getBlock('magelens.layout.grammar.serviceurl')->getData('value');
    if (!is_string($value) || !str_ends_with((string) parse_url($value, PHP_URL_PATH), '/rest/default/V1/coverageprobe/fragment/index')
        || parse_url($value, PHP_URL_QUERY) !== null) {
        throw new RuntimeException('Native service URL path or ignored parameter behavior changed');
    }
    echo "Verified native service URL path application and ignored parameters.\n";
    if (in_array('--without-collector', $argv, true)) exit;
    finishArgumentFields($collector, $argv);
    $events = array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue());
    $field = array_values(array_filter($files[0]['declarations'], static fn($item) => $item['layout']['attribute'] === 'path'))[0];
    $effects = array_column(array_filter($events, static fn($event) => $event['id'] === $field['id']), 'type');
    if ($effects !== ['layout-argument-modifier-evaluated']) throw new RuntimeException('Original service URL path lacks native consumer evidence');
    echo "Verified original service URL path independently of ignored parameters.\n";
    exit;
}
if ($firstLayout) {
    $page = $objects->get(Magento\Framework\View\Result\PageFactory::class)->create(true, ['isIsolated' => true]);
    $page->addHandle('coverageprobe_argumentownership_native');
    $block = $page->getLayout()->getBlock('magelens.layout.argument.native');
    if (!$block || $block->getData('value') !== 'xml-value' || $block->getData('late') !== 'xml-value'
        || $block->getData('action_value') !== 'xml-value'
        || $block->getData('nested') !== ['changed' => 'xml-value', 'surviving' => 'xml-value']
        || !str_contains($block->toHtml(), 'data-layout-mutation>xml-value</span>')) {
        throw new RuntimeException('Native first-layout deferred interpretation changed');
    }
    if ($foreignLookup && ($initializations !== 1 || !$nativeInitialization || $foreignObserved !== 1)) throw new RuntimeException('Type attribution changed native lazy initialization count');
    echo "Verified native deferred values in the first isolated layout without default-handle initialization.\n";
    if (in_array('--without-collector', $argv, true)) exit;
    finishArgumentFields($collector, $argv);
    $events = array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue());
    foreach ($files[0]['declarations'] as $declaration) {
        if ($declaration['layout']['kind'] !== 'argument-type') continue;
        $types = array_column(array_filter($events, static fn($event) => $event['id'] === $declaration['id']), 'type');
        if (!in_array('layout-argument-type-evaluated', $types, true)) {
            throw new RuntimeException('First-layout type origin lacks native consumer evidence at ' . $declaration['node']);
        }
    }
    echo "Verified original first-layout type dispatch before interpreter initialization is reused.\n";
    exit;
}
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
if (in_array('--nested-types', $argv, true) && $block->getData('indexed') !== [
    'visited' => 'indexed-read', 'unread' => 'indexed-unread', 'nullable' => null,
    'nested' => ['leaf' => 'indexed-path']]) throw new RuntimeException('Native nested typed-value inventory changed');
if ($actionTypeProof && $actionTypes !== ['string', 'configurableObject', 'string', 'string']) {
    throw new RuntimeException('Native root action interpreter dispatch changed: ' . implode(', ', $actionTypes));
}
echo "Verified native typed values, nested overlays, shared/fresh identities, translation, options, helper/URL parameters and action dispatch.\n";
if ($forwarder && MageLensArgumentFieldForwarder::$calls === 0) throw new RuntimeException('Custom interpreter forwarding was bypassed');
if ($custom && MageLensArgumentFieldDispatch::$calls === 0) throw new RuntimeException('Custom type selector was bypassed');
if ($customItems && MageLensArgumentItemSorter::$calls === 0) throw new RuntimeException('Custom native item sorter was bypassed');
if (in_array('--without-collector', $argv, true)) exit;
$state = finishArgumentFields($collector, $argv);
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
if (in_array('--action-types', $argv, true)) {
    $count = 0;
    foreach ($files as $fileIndex => $file) foreach ($file['declarations'] as $declaration) {
        if ($declaration['layout']['attribute'] !== 'xsi:type'
            || !preg_match('~/action\\[(\\d+)\\]/argument/@xsi:type$~', $declaration['node'], $match)) continue;
        $count++;
        $position = (int)$match[1];
        $effects = array_column(array_filter($events, static fn($event) => $event['id'] === $declaration['id']), 'type');
        $evaluated = $fileIndex === 0 ? in_array($position, [1, 3], true) : $position === 1;
        if (in_array('layout-argument-type-evaluated', $effects, true) !== $evaluated) {
            throw new RuntimeException('Original action type operand differs from its native interpretation: ' . $declaration['node']);
        }
    }
    if ($count !== 6) throw new RuntimeException('Original action type operand inventory changed');
    echo "Verified original action type evaluation, denied and ambiguous operands independently.\n";
}
if (in_array('--nested-types', $argv, true)) {
    $count = 0;
    foreach ($files as $file) foreach ($file['declarations'] as $declaration) {
        if ($declaration['layout']['instruction'] !== 'item' || $declaration['layout']['attribute'] !== 'xsi:type') continue;
        $count++;
        $types = array_column(array_filter($events, static fn($event) => $event['id'] === $declaration['id']), 'type');
        if (in_array('layout-argument-type-evaluated', $types, true) === $customItems
            || ($customItems && !in_array('layout-argument-type-origin-unconfirmed', $types, true))) {
            throw new RuntimeException('Original nested type operand differs from native item traversal at ' . $declaration['node']);
        }
    }
    if ($count !== 12) throw new RuntimeException('Native nested type inventory changed');
    if ($customItems) foreach ($files as $file) foreach ($file['declarations'] as $declaration) {
        if ($declaration['layout']['instruction'] !== 'item' || $declaration['layout']['kind'] !== 'argument') continue;
        $types = array_column(array_filter($events, static fn($event) => $event['id'] === $declaration['id']), 'type');
        if (in_array('layout-argument-applied', $types, true)
            || !in_array('layout-argument-origin-unconfirmed', $types, true)) {
            throw new RuntimeException('Custom item sorter retained original value application credit at ' . $declaration['node']);
        }
    }
}
if (in_array('--modifier-fields', $argv, true)) {
    $count = 0;
    foreach ($files as $file) foreach ($file['declarations'] as $declaration) {
        $attribute = $declaration['layout']['attribute'];
        if ($declaration['layout']['instruction'] !== 'argument'
            || !in_array($attribute, ['translate', 'shared', 'model', 'helper', 'path'], true)) continue;
        $count++;
        $types = array_column(array_filter($events, static fn($event) => $event['id'] === $declaration['id']), 'type');
        $updater = str_contains($declaration['node'], '/argument[13]/');
        $replaced = ($custom || $forwarder) ? !$updater
            : ($alternate && !$updater && $attribute === 'translate');
        if (in_array('layout-argument-modifier-evaluated', $types, true) === $replaced
            || ($replaced && !in_array('layout-argument-modifier-origin-unconfirmed', $types, true))) {
            throw new RuntimeException('Original argument modifier differs from native consumer evidence at ' . $declaration['node']);
        }
    }
    if ($count !== 9) throw new RuntimeException('Native argument modifier inventory changed');
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
