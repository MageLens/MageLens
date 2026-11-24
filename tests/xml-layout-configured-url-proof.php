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

use MageLens\Compatibility\Model\LayoutConfiguredData;
use MageLens\XmlCoverage\{LayoutCoverage, LayoutManifest, LayoutRuntimeHooks, Recorder};
use Magento\Framework\App\Area;
use Magento\Framework\Config\Dom;
use Magento\Framework\Data\Argument\Interpreter\Composite;
use Magento\Framework\View\Layout\Argument\Parser;
use Magento\Framework\View\Result\PageFactory;

$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_grammar_configuredurl.xml';
$source = file_get_contents(BP . '/' . $path);
$file = ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
    'declarations' => LayoutManifest::declarations($path, $source)];
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets([$file]));
$nativeOnly = in_array('--without-collector', $argv, true);
if (!$nativeOnly) foreach ($callbacks as [$class, $method, $pre, $post]) {
    if (!LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot observe configurable URL');
}
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
foreach ([Area::PART_CONFIG, Area::PART_DESIGN] as $part) $area->load($part);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$objects->get(Magento\Framework\App\ViewInterface::class);
$namespace = 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
$parser = $objects->get(Parser::class);
$interpreter = $objects->get(Composite::class);
foreach (['helper' => 'helper="MageLens\Compatibility\Model\LayoutArgumentSource::join"',
    'url' => 'path="coverageprobe/fragment/index"'] as $type => $selector) {
    foreach ([1, 2] as $count) {
        $values = '<param name="first">alpha</param>' . ($count === 2 ? '<param name="second">beta</param>' : '');
        $sourceOperand = '<argument name="data" xsi:type="' . $type . '" ' . $selector . '>' . $values . '</argument>';
        $xml = '<layout ' . $namespace . '><block name="probe"><action method="setData">'
            . '<argument name="configured" xsi:type="configurableObject"><argument name="class" xsi:type="string">'
            . LayoutConfiguredData::class . '</argument>' . $sourceOperand . '</argument></action></block></layout>';
        $doc = new DOMDocument();
        $doc->loadXML($xml, LIBXML_NONET);
        if (Dom::validateDomDocument($doc, 'urn:magento:framework:View/Layout/etc/layout_generic.xsd')) {
            throw new RuntimeException('Configured parameter control is outside native grammar');
        }
        $node = (new DOMXPath($doc))->query('/layout/block/action/argument')->item(0);
        $parsed = null;
        try {
            $parsed = $parser->parse($node);
        } catch (UnexpectedValueException $error) {
            if ($count !== 2 || !str_contains($error->getMessage(), 'argument/argument/param')) throw $error;
        }
        if ($count === 1) {
            if ($parsed['argument']['data']['param'] !== ['name' => 'first', 'value' => 'alpha']) {
                throw new RuntimeException('Native configurable parameter parser no longer flattens a direct parameter');
            }
            try {
                $interpreter->evaluate($parsed);
                throw new RuntimeException('Direct configured parameter unexpectedly evaluated');
            } catch (InvalidArgumentException $error) {
                $expectedFailure = $type === 'helper' ? "Argument interpreter named 'helper' has not been defined."
                    : 'Parameter data of layout argument is expected to be an array.';
                if ($error->getMessage() !== $expectedFailure) throw $error;
            }
        } elseif ($parsed !== null) {
            throw new RuntimeException('Repeated direct configured parameters unexpectedly parsed');
        }
        if (!$nativeOnly) {
            $operands = array_filter(LayoutManifest::declarations($path, $xml), static fn($row) => $row['layout']['instruction'] === 'param');
            if (count($operands) !== $count * 2) throw new RuntimeException('Original direct parameter inventory changed');
            foreach ($operands as $operand) {
                $reason = $type === 'helper' ? 'no helper interpreter' : 'flattens a single parameter';
                if ($operand['supported'] || !str_contains($operand['reason'], $reason)) {
                    throw new RuntimeException('Missing tested configured parameter limitation');
                }
            }
        }
    }
}
echo "Verified direct configurable helper and URL parser and interpreter limits.\n";
$page = $objects->get(PageFactory::class)->create(true, ['isIsolated' => true]);
$page->addHandle('coverageprobe_grammar_configuredurl');
$value = $page->getLayout()->getBlock('magelens.layout.grammar.configuredurl')->getData('value');
if (!$value instanceof LayoutConfiguredData || !is_string($value->getData('generated'))
    || !str_contains((string) parse_url($value->getData('generated'), PHP_URL_PATH), '/coverageprobe/fragment/index/first/alpha/second/beta/')) {
    throw new RuntimeException('Native configured URL did not supply its original path and named operands');
}
if (hash_file('sha256', BP . '/' . $path) !== $file['sourceHash']) throw new RuntimeException('Native configurable URL fixture changed source');
echo "Verified native configurable URL and both named values in the constructed object.\n";
if ($nativeOnly) exit;
$collector->finish();
$events = array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue());
$prefix = '/page/body/block/arguments/argument/argument[2]/item';
$expected = [
    $prefix => 'layout-configured-item-evaluated',
    $prefix . '/@xsi:type' => 'layout-argument-type-evaluated',
    $prefix . '/@path' => 'layout-argument-modifier-evaluated',
    $prefix . '/param[1]' => 'layout-parameter-evaluated',
    $prefix . '/param[1]/@name' => 'layout-parameter-name-applied',
    $prefix . '/param[2]' => 'layout-parameter-evaluated',
    $prefix . '/param[2]/@name' => 'layout-parameter-name-applied',
];
foreach ($file['declarations'] as $declaration) {
    $node = $declaration['node'];
    if (!isset($expected[$node])) continue;
    $actual = array_values(array_unique(array_column(array_filter($events, static fn($row) => $row['id'] === $declaration['id']), 'type')));
    if ($actual !== [$expected[$node]]) throw new RuntimeException('Configured URL effect differs at ' . $node . ': ' . implode(', ', $actual));
    unset($expected[$node]);
}
if ($expected) throw new RuntimeException('Configured URL source inventory changed');
echo "Verified original configurable item, URL path and named parameter effects.\n";
