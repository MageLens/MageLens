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
$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_templatevalues.xml';
$source = file_get_contents(BP . '/' . $path);
$files = [['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
    'declarations' => LayoutManifest::declarations($path, $source)]];
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
$missing = in_array($argv[1] ?? '', ['--missing-constructor-pre', '--missing-constructor-post', '--missing-getter', '--missing-setter', '--missing-query'], true) ? $argv[1] : null;
$bound = in_array('--method-limit', $argv, true) ? 'count' : (in_array('--method-name-limit', $argv, true) ? 'name' : null);
if ($bound === 'count' && !in_array('--without-collector', $argv, true)) {
    $checks = [];
    for ($number = 0; $number < 1024; $number++) $checks['fixture.bound.' . $number] = false;
    (new ReflectionProperty($collector, 'templateValueMethods'))->setValue($collector, $checks);
}
if (!in_array('--without-collector', $argv, true)) foreach ($callbacks as [$class, $method, $pre, $post]) {
    $owner = $pre ?? $post;
    $main = $owner instanceof Closure && (new ReflectionFunction($owner))->getClosureThis() === $collector;
    if ($main && $class === Magento\Framework\View\Element\Template::class && $method === '_construct') {
        if ($missing === '--missing-constructor-pre') $pre = null;
        if ($missing === '--missing-constructor-post') $post = null;
    }
    if ($main && (($missing === '--missing-getter' && $class === Magento\Framework\DataObject::class && $method === 'getData')
        || ($missing === '--missing-setter' && $class === Magento\Framework\View\Element\Template::class && $method === 'setTemplate')
        || ($missing === '--missing-query' && $class === Magento\Framework\Interception\PluginListInterface::class && $method === 'getNext'))) $post = null;
    if (!LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot register template value proof');
}
$queryRequired = false;
OpenTelemetry\Instrumentation\hook(Magento\Framework\View\Element\Template::class, '_construct',
    static function ($block) use ($collector, &$queryRequired): void {
        $frames = (new ReflectionProperty($collector, 'generating'))->getValue($collector);
        $index = array_key_last($frames);
        $candidate = $index === null ? null : $frames[$index]['constructorTemplate'];
        if (!$candidate || $candidate['block'] !== $block || !$candidate['trusted']) return;
        foreach (['hasData' => Magento\Framework\DataObject::class, 'getData' => Magento\Framework\DataObject::class,
            'setTemplate' => Magento\Framework\View\Element\Template::class] as $method => $native) {
            if ((new ReflectionMethod($block, $method))->getDeclaringClass()->getName() !== $native) $queryRequired = true;
        }
    }, null);
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
$area->load(Magento\Framework\App\Area::PART_CONFIG); $area->load(Magento\Framework\App\Area::PART_DESIGN);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$objects->get(Magento\Framework\App\ViewInterface::class);
$result = $objects->create(MageLens\Compatibility\Controller\Templatevalues\Index::class)->execute();
$response = $objects->create(Magento\Framework\App\Response\Http::class);
$result->renderResult($response);
if (!str_contains($response->getBody(), '<span data-layout-template-value-proof>verified</span>')) throw new RuntimeException('Native template value proof marker is missing');
echo "Verified native constructor/action template selections, equal-valued XML/PHP replacements, empty/zero values and unrendered output.\n";
if (in_array('--without-collector', $argv, true)) exit;
if ($bound === 'name') {
    $type = 'MageLensTemplateValueBound' . str_repeat('X', 4096);
    eval('class ' . $type . ' extends \\Magento\\Framework\\View\\Element\\Template {}');
    $subject = (new ReflectionClass($type))->newInstanceWithoutConstructor();
    if ((new ReflectionMethod($collector, 'templateValueMethod'))->invoke($collector, $subject, 'setTemplate', Magento\Framework\View\Element\Template::class)) {
        throw new RuntimeException('Oversized template method identity was accepted');
    }
}
try { $state = $collector->finish(); }
catch (RuntimeException $error) {
    if (($missing === null && $bound === null) || !preg_match('/template|constructor/i', $error->getMessage())) throw $error;
    echo "Verified missing template-value observation rejects publication after unchanged native output.\n";
    exit;
}
if (($missing !== null && ($missing !== '--missing-query' || $queryRequired)) || $bound !== null) {
    throw new RuntimeException('Missing or unbounded template-value evidence was accepted');
}
if ($missing === '--missing-query') echo "Verified this native path has no generated accessor plugin query; exact evidence remains required.\n";
$events = array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue());
$evidencePath = array_search('--evidence-file', $argv, true);
if ($evidencePath !== false) {
    $encoded = json_encode(['files' => $files,
        'layoutSources' => LayoutManifest::targets($files), 'layoutHook' => $state[0],
        'layoutSourceTrace' => $state[1], 'layoutLimitations' => $state[2], 'events' => $events], JSON_THROW_ON_ERROR);
    if (file_put_contents($argv[$evidencePath + 1], $encoded) !== strlen($encoded)) throw new RuntimeException('Cannot write bounded template value evidence');
    echo "Wrote bounded original-source proof evidence without response bytes.\n";
    exit;
}
foreach ([1 => [false, true], 2 => [true, true], 3 => [true, true], 4 => [false, false],
    5 => [false, false], 6 => [true, false], 7 => [false, false], 8 => [false, false],
    9 => [true, false], 10 => [true, false], 11 => [false, true], 12 => [true, true], 13 => [false, true],
    0 => [false, false]] as $position => [$action, $executed]) {
    $node = ($position === 0 ? '/layout/block' : '/layout/container/block[' . $position . ']')
        . ($action ? '/action/argument' : '/arguments/argument');
    $items = array_values(array_filter($files[0]['declarations'], static fn($item) => $item['node'] === $node));
    if (count($items) !== 1) throw new RuntimeException('Missing original template value declaration');
    $types = array_column(array_filter($events, static fn($event) => $event['id'] === $items[0]['id']), 'type');
    if (!in_array('layout-template-selected', $types, true)
        || in_array('layout-template-executed', $types, true) !== $executed
        || ($position === 4 && !in_array('layout-template-overridden', $types, true))
        || (in_array($position, [5, 6], true) && !in_array('layout-template-replaced', $types, true))) {
        throw new RuntimeException('Original constructor/action template value ownership differs from native execution');
    }
}
echo "Verified original constructor/action template values, independent precedence and exact execution/zero-hit cases.\n";
