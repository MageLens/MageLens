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

$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_nestedarguments.xml';
$source = file_get_contents(BP . '/' . $path);
$files = [['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
    'declarations' => LayoutManifest::declarations($path, $source)]];
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
if (!in_array('--without-collector', $argv, true)) foreach ($callbacks as [$class, $method, $pre, $post]) {
    if (!LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot observe nested modifier fixture');
}
$nativeParameters = [];
if (in_array('--parameters', $argv, true) && !LayoutRuntimeHooks::register(
    Magento\Framework\View\Layout\Argument\Interpreter\NamedParams::class, 'evaluate', null,
    static function ($interpreter, array $params, $result, ?Throwable $error) use (&$nativeParameters): void {
        if (!$error && ($result === ['first' => 'nested', 'second' => 'helper'] || $result === ['variant' => 'nested'])) {
            $nativeParameters[] = $result;
        }
    })) throw new RuntimeException('Cannot observe native parameter map assignment');
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
foreach ([Magento\Framework\App\Area::PART_CONFIG, Magento\Framework\App\Area::PART_DESIGN] as $part) $area->load($part);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$result = $objects->create(MageLens\Compatibility\Controller\Nestedarguments\Index::class)->execute();
$html = (new ReflectionProperty(Magento\Framework\Controller\Result\Raw::class, 'contents'))->getRawValue($result);
if (substr_count($html, '>verified</span>') !== 6) throw new RuntimeException('Expected six native nested modifier outcomes');
if (hash_file('sha256', BP . '/' . $path) !== hash('sha256', $source)) throw new RuntimeException('Nested fixture source changed');
echo "Verified native nested lifetimes, translation flags, model/helper/URL values and ignored group.\n";
if (in_array('--parameters', $argv, true)) {
    if ($nativeParameters !== [['first' => 'nested', 'second' => 'helper'], ['variant' => 'nested']]) {
        throw new RuntimeException('Native helper/URL parameter map assignment changed');
    }
    echo "Verified native helper/URL parameter names and values through real fragment construction.\n";
}
if (in_array('--without-collector', $argv, true)) exit;
$state = $collector->finish();
$events = array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue());
$counts = [0, 0];
foreach ($files[0]['declarations'] as $declaration) {
    if (!in_array($declaration['layout']['kind'], ['argument-shared', 'argument-translate', 'argument-model', 'argument-helper', 'argument-path'], true)) continue;
    $ignored = str_contains($declaration['node'], '/arguments[2]/');
    $counts[(int) $ignored]++;
    $effects = array_column(array_filter($events, static fn($event) => $event['id'] === $declaration['id']), 'type');
    if ($ignored ? $effects !== ['layout-argument-group-ignored'] : !in_array('layout-argument-modifier-evaluated', $effects, true)) {
        throw new RuntimeException('Original nested modifier lacks exact native evidence: ' . $declaration['node'] . ': ' . implode(', ', $effects));
    }
}
if ($counts !== [9, 5]) throw new RuntimeException('Original nested modifier inventory changed');
echo "Verified nine evaluated nested fields and five ignored nested fields independently.\n";
if (in_array('--parameters', $argv, true)) {
    $counts = [0, 0];
    foreach ($files[0]['declarations'] as $declaration) {
        if ($declaration['layout']['instruction'] !== 'param') continue;
        $ignored = str_contains($declaration['node'], '/arguments[2]/');
        $counts[(int) $ignored]++;
        $effects = array_column(array_filter($events, static fn($event) => $event['id'] === $declaration['id']), 'type');
        $expected = $declaration['layout']['attribute'] === 'name' ? 'layout-parameter-name-applied' : 'layout-parameter-evaluated';
        if ($ignored ? $effects !== ['layout-argument-group-ignored'] : !in_array($expected, $effects, true)) {
            throw new RuntimeException('Original named parameter lacks independent evidence: ' . $declaration['node']);
        }
    }
    if ($counts !== [6, 4]) throw new RuntimeException('Original named parameter inventory changed');
    echo "Verified three applied parameter values/names and two ignored parameter values/names.\n";
}

$destination = array_search('--evidence-file', $argv, true);
if ($destination !== false) {
    $json = json_encode(['files' => $files, 'layoutSources' => LayoutManifest::targets($files), 'layoutHook' => $state[0],
        'layoutSourceTrace' => $state[1], 'layoutLimitations' => $state[2], 'events' => $events], JSON_THROW_ON_ERROR);
    if (file_put_contents($argv[$destination + 1], $json) !== strlen($json)) throw new RuntimeException('Cannot save bounded nested fixture evidence');
}
