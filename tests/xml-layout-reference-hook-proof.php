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

$mode = str_starts_with($argv[1] ?? '', '--') ? 'native' : ($argv[1] ?? 'native');
$missing = [
    'missing-block-reader' => [Magento\Framework\View\Layout\Reader\Block::class, 'scheduleReference'],
    'missing-container-reader' => [Magento\Framework\View\Layout\Reader\Container::class, 'containerReference'],
    'missing-structure' => [Magento\Framework\View\Layout\GeneratorPool::class, 'buildStructure'],
    'missing-generator' => [Magento\Framework\View\Layout\GeneratorPool::class, 'process'],
    'missing-removal' => [Magento\Framework\View\Layout\GeneratorPool::class, 'removeElement'],
    'missing-child-schedule' => [Magento\Framework\View\Layout\ScheduledStructure\Helper::class, 'scheduleStructure'],
    'missing-child-writer' => [Magento\Framework\View\Layout\ScheduledStructure::class, 'setStructureElement'],
    'missing-child-parent' => [Magento\Framework\Data\Structure::class, 'setAsChild'],
    'missing-child-lookup' => [Magento\Framework\Data\Structure::class, 'hasElement'],
    'missing-child-helper' => [Magento\Framework\View\Layout\ScheduledStructure\Helper::class, 'scheduleElement'],
];
$base = preg_replace('/-(pre|post)$/', '', $mode);
$depths = ['structure-depth' => ['building', 'structure'], 'removal-depth' => ['removing', 'removal'],
    'generator-depth' => ['processing', 'generator process'], 'schedule-depth' => ['scheduling', 'child scheduling'],
    'placement-depth' => ['placing', 'child placement']];
if (!in_array($mode, ['native', 'equal-schedule', 'custom-block-reader', 'custom-container-reader'], true) && !isset($missing[$base]) && !isset($depths[$mode])) throw new RuntimeException('Unknown reference proof mode');
$skipped = false;

$files = [];
foreach (['Compatibility' => ['base', 'overlay', 'index', 'never'], 'LayoutOverlay' => ['overlay']] as $module => $handles) {
    foreach ($handles as $handle) {
        $path = 'app/code/MageLens/' . $module . '/view/frontend/layout/coverageprobe_references_' . $handle . '.xml';
        $source = file_get_contents(BP . '/' . $path);
        $files[] = ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
            'declarations' => LayoutManifest::declarations($path, $source)];
    }
}
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
if (isset($depths[$mode])) {
    $references = (new ReflectionProperty($collector, 'references'))->getValue($collector);
    (new ReflectionProperty($references, $depths[$mode][0]))->setValue($references, array_fill(0, 256, ['source' => null, 'schedule' => new stdClass(), 'structure' => new stdClass(), 'pool' => new stdClass()]));
}
foreach ($callbacks as [$class, $method, $pre, $post]) {
    if (in_array('--without-collector', $argv, true)) continue;
    $owner = $pre ?? $post;
    if (isset($missing[$base]) && $missing[$base] === [$class, $method]
        && $owner instanceof Closure && (new ReflectionFunction($owner))->getClosureThis() instanceof MageLens\XmlCoverage\LayoutReferenceCoverage) {
        $skipped = true;
        if (str_ends_with($mode, '-pre')) $pre = null;
        elseif (str_ends_with($mode, '-post')) $post = null;
        else continue;
    }
    if (!OpenTelemetry\Instrumentation\hook($class, $method, $pre, $post)) throw new RuntimeException('Cannot register native reference proof hook');
}
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
$area->load(Area::PART_CONFIG); $area->load(Area::PART_DESIGN);
if ($mode === 'custom-block-reader') {
    class MageLensReferenceBlockReader extends Magento\Framework\View\Layout\Reader\Block
    {
        public static int $calls = 0;
        protected function scheduleReference(Magento\Framework\View\Layout\ScheduledStructure $schedule,
            Magento\Framework\View\Layout\Element $xml)
        {
            self::$calls++;
            return parent::scheduleReference($schedule, $xml);
        }
    }
    $customReader = MageLensReferenceBlockReader::class;
    $baseReader = Magento\Framework\View\Layout\Reader\Block::class;
} elseif ($mode === 'custom-container-reader') {
    class MageLensReferenceContainerReader extends Magento\Framework\View\Layout\Reader\Container
    {
        public static int $calls = 0;
        protected function containerReference(Magento\Framework\View\Layout\ScheduledStructure $schedule,
            Magento\Framework\View\Layout\Element $xml)
        {
            self::$calls++;
            return parent::containerReference($schedule, $xml);
        }
    }
    $customReader = MageLensReferenceContainerReader::class;
    $baseReader = Magento\Framework\View\Layout\Reader\Container::class;
}
if (isset($customReader)) {
    $configuration = $objects->get(Magento\Framework\ObjectManager\ConfigInterface::class);
    if ($configuration instanceof Magento\Framework\ObjectManager\Config\Compiled) {
        $native = $configuration->getInstanceType($configuration->getPreference($baseReader));
        $arguments = $configuration->getArguments($native);
        if (!is_array($arguments) || !$arguments) throw new RuntimeException('Native compiled reader constructor is unavailable');
        $names = array_fill_keys(array_map(static fn($parameter) => $parameter->getName(),
            (new ReflectionMethod($customReader, '__construct'))->getParameters()), true);
        $configuration->extend(['arguments' => [$customReader => array_intersect_key($arguments, $names)]]);
    }
    $objects->configure(['preferences' => [$baseReader => $customReader]]);
}
if ($mode === 'equal-schedule') $objects->get(MageLens\Compatibility\Model\LayoutMoveMutation::class)->replaceReferenceChild = true;
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$result = $objects->get(MageLens\Compatibility\Controller\References\Index::class)->execute();
$output = (new ReflectionProperty(Magento\Framework\Controller\Result\Raw::class, 'contents'))->getRawValue($result);
if (!str_contains($output, 'data-layout-reference-proof>verified</span>')) throw new RuntimeException('Missing native reference output');
echo "Verified native reference template, values, calls, visibility, missing target and unrendered output.\n";
if ($mode === 'equal-schedule' && $objects->get(MageLens\Compatibility\Model\LayoutMoveMutation::class)->referenceCalls !== 1) {
    throw new RuntimeException('Native equal reference rescheduling was bypassed');
}
if (isset($customReader) && $customReader::$calls === 0) throw new RuntimeException('Custom native reader fixture was bypassed');
if (in_array('--without-collector', $argv, true)) exit;
try {
    $collector->finish();
    if (isset($missing[$base]) || isset($depths[$mode])) throw new LogicException('Missing reference observation was accepted');
} catch (RuntimeException $error) {
    $expected = ['missing-block-reader' => 'Missing native layout reference reader hook evidence',
        'missing-container-reader' => 'Missing native layout reference reader hook evidence',
        'missing-structure' => 'Missing native layout reference structure hook evidence',
        'missing-generator' => 'Missing native layout reference generator process hook evidence',
        'missing-removal' => 'Missing native layout reference removal hook evidence',
        'missing-child-schedule' => 'Missing native layout reference child schedule hook evidence',
        'missing-child-writer' => 'Missing native layout reference child schedule writer hook evidence',
        'missing-child-parent' => 'Missing native layout reference parent setter hook evidence',
        'missing-child-lookup' => 'Missing native layout reference parent lookup hook evidence',
        'missing-child-helper' => 'Missing native layout reference child helper hook evidence'][$base] ?? null;
    if (str_ends_with($mode, '-pre') || str_ends_with($mode, '-post')) $expected = 'Unbalanced native layout reference';
    if (isset($depths[$mode])) { $skipped = true; $expected = 'Layout reference ' . $depths[$mode][1] . ' nesting exceeded 256 calls'; }
    if (!$skipped || !$expected || !str_contains($error->getMessage(), $expected)) throw $error;
    echo "Verified reference hook publication guard for $mode.\n";
    exit;
}
$events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
foreach ($files as $file) {
    foreach ($file['declarations'] as $item) {
        if (!in_array($item['layout']['kind'], ['reference', 'reference-name'], true)) continue;
        $types = array_values(array_unique(array_column(array_filter($events,
            static fn($event) => $event['id'] === $item['id']), 'type')));
        sort($types);
        $name = $item['layout']['element'];
        $expected = match (true) {
            str_ends_with($file['path'], '_never.xml') => [],
            str_contains($file['path'], '/LayoutOverlay/') => ['layout-reference-target-observed', 'layout-template-executed', 'layout-template-selected'],
            str_ends_with($file['path'], '_base.xml') => ['layout-reference-target-observed', 'layout-reference-unchanged'],
            $name === 'magelens.reference.subject' => ['layout-action-executed', 'layout-argument-applied', 'layout-argument-read', 'layout-reference-target-observed', 'layout-template-overridden'],
            $name === 'magelens.reference.inner' => ['layout-container-wrapper-rendered',
                $mode === 'equal-schedule' ? 'layout-reference-child-replaced' : 'layout-reference-child-attached', 'layout-reference-target-observed'],
            $name === 'magelens.reference.removed' => ['layout-removal-applied'],
            $name === 'magelens.reference.removed.child' => ['layout-reference-target-removed'],
            $name === 'magelens.reference.hidden' => ['layout-display-denied', 'layout-reference-target-observed'],
            in_array($name, ['magelens.reference.missing', 'magelens.reference.absent.parent'], true) => ['layout-reference-target-missing'],
            $name === 'magelens.reference.unrendered' => ['layout-reference-target-observed', 'layout-template-selected'],
            $name === 'magelens.reference.empty' => ['layout-reference-target-observed'],
            default => throw new RuntimeException('Unknown reference fixture target'),
        };
        if (isset($customReader) && !str_ends_with($file['path'], '_never.xml')) $expected = ['layout-xml-ownership-revoked'];
        if ($types !== $expected) throw new RuntimeException('Reference evidence differs for ' . $name . ': ' . implode(', ', $types));
    }
}
echo "Verified independent reference/name origins, exact native effects, zero-hit outcomes and unvisited declarations.\n";
