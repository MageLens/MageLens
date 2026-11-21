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
use Magento\Framework\Component\{ComponentRegistrar, ComponentRegistrarInterface};
use Magento\Framework\View\File\CollectorInterface;
use Magento\Framework\View\File\Collector\Decorator\ModuleOutput;

$outputPath = 'advanced/modules_disable_output/MageLens_LayoutDisabled';
if (array_intersect($argv, ['--set-output-disabled', '--clear-output-disabled'])) {
    $manager = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
    $writer = $manager->get(Magento\Framework\App\Config\Storage\WriterInterface::class);
    if (in_array('--set-output-disabled', $argv, true)) $writer->save($outputPath, 1);
    else $writer->delete($outputPath);
    exit;
}

$path = 'app/code/MageLens/LayoutDisabled/view/frontend/layout/coverageprobe_theme_index.xml';
$source = file_get_contents(BP . '/' . $path);
$files = [['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
    'declarations' => LayoutManifest::declarations($path, $source)]];
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
$missing = array_intersect($argv, ['--missing-filter-pre', '--missing-filter-post', '--missing-filter-candidates']);

if (!in_array('--without-collector', $argv, true)) foreach ($callbacks as [$class, $method, $pre, $post]) {
    if ($class === ModuleOutput::class && $method === 'getFiles') {
        if (in_array('--missing-filter-pre', $missing, true)) $pre = null;
        if (in_array('--missing-filter-post', $missing, true)) $post = null;
    }
    if ($class === CollectorInterface::class && $method === 'getFiles' && in_array('--missing-filter-candidates', $missing, true)) $post = null;
    if (!LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot observe native disabled-provider proof');
}
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
foreach ([Magento\Framework\App\Area::PART_CONFIG, Magento\Framework\App\Area::PART_DESIGN] as $part) $area->load($part);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$registered = $objects->get(ComponentRegistrarInterface::class)->getPath(ComponentRegistrar::MODULE, 'MageLens_LayoutDisabled');
if ($registered !== BP . '/app/code/MageLens/LayoutDisabled') throw new RuntimeException('Disabled fixture module is not registered at its original path');
$enabled = in_array('--enabled', $argv, true) || in_array('--output-disabled', $argv, true);
$available = $enabled && !in_array('--output-disabled', $argv, true);
if ($objects->get(Magento\Framework\Module\ModuleListInterface::class)->has('MageLens_LayoutDisabled') !== $enabled) {
    throw new RuntimeException('Native installed fixture module state differs from expected selection');
}
if ($objects->get(Magento\Framework\Module\Manager::class)->isOutputEnabled('MageLens_LayoutDisabled') !== $available) {
    throw new RuntimeException('Native module output setting differs from the fixture mode');
}
$fragment = $objects->create(Magento\Framework\View\Result\Layout::class, ['isIsolated' => true]);
$unvisited = in_array('--unvisited', $argv, true);
$fragment->addHandle($unvisited ? 'coverageprobe_fragment_index' : 'coverageprobe_theme_index');
$layout = $fragment->getLayout();
$block = $layout->getBlock('magelens.layout.provider.disabled');
$html = $layout->getOutput();
if ($unvisited) {
    if ($block !== false || !str_contains($html, 'fragment-marker')) {
        throw new RuntimeException('Unrelated layout traversal or output changed');
    }
} elseif (($block !== false) !== $available || str_contains($html, 'provider.disabled') !== $available
    || !str_contains($html, 'provider.base')) {
    throw new RuntimeException('Native module selection or active provider output changed');
}
if (hash_file('sha256', BP . '/' . $path) !== hash('sha256', $source)) throw new RuntimeException('Original disabled provider source changed');
if ($unvisited) echo "Verified an unrelated native handle while the module is excluded.\n";
else echo 'Verified native registered provider is ', $available ? 'enabled and rendered' : ($enabled ? 'enabled with output excluded' : 'disabled and excluded'), ".\n";
if (in_array('--without-collector', $argv, true)) exit;
try {
    $collector->finish();
    if ($missing) throw new LogicException('Missing filter evidence did not block publication');
} catch (RuntimeException $error) {
    if (!$missing || !str_contains($error->getMessage(), 'layout provider')) throw $error;
    echo "Verified unchanged exclusion with a rejected incomplete native filter observation.\n";
    exit;
}
$events = array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue());
$ids = array_fill_keys(array_column($files[0]['declarations'], 'id'), true);
$effects = array_values(array_filter($events, static fn($event) => isset($ids[$event['id']])));
if ($unvisited) {
    if ($effects) throw new RuntimeException('Unvisited provider received a request-scoped exclusion decision');
    echo "Verified the unvisited provider remains fully inventoried with zero hits and no exclusion decision.\n";
    exit;
}
if ($available) {
    if (!in_array('layout-block-rendered', array_column($effects, 'type'), true)) throw new RuntimeException('Enabled provider lacks original block rendering');
} else {
    $kinds = array_unique(array_column($effects, 'type'));
    if ($kinds !== ['layout-file-provider-excluded'] || count($effects) < 2) {
        throw new RuntimeException('Missing precise native provider exclusion evidence or unexpected original hits');
    }
}
echo "Verified original provider selection distinguishes native rendering from explicit zero-hit provider exclusion.\n";
