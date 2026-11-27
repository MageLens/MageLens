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

use MageLens\XmlCoverage\{LayoutCoverage, LayoutManifest, Recorder};
use Magento\Framework\App\Area;

$mode = $argv[1] ?? 'native';
if (!in_array($mode, ['native', 'unverified-scope'], true)) throw new RuntimeException('Unknown shared block proof');
$files = [];
foreach (['first', 'second'] as $case) {
    $path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_shared_' . $case . '.xml';
    $source = file_get_contents(BP . '/' . $path);
    $files[] = ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
        'declarations' => LayoutManifest::declarations($path, $source)];
}
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
foreach ($callbacks as [$class, $method, $pre, $post]) {
    if (!\MageLens\XmlCoverage\LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot register shared block proof hook');
}
$scope = null;
$replacements = 0;
if ($mode === 'unverified-scope') {
    OpenTelemetry\Instrumentation\hook(Magento\Framework\View\Layout::class, '__construct', null,
        static function ($layout, array $params, $result, ?Throwable $error, string $class) use (&$scope, &$replacements): void {
            if ($scope === null || $error || $class !== Magento\Framework\View\Layout::class
                || $layout instanceof Magento\Framework\Interception\InterceptorInterface
                || !(new ReflectionObject($layout))->hasProperty('____scope')) return;
            $created = array_filter(debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 24),
                static fn($frame) => ($frame['class'] ?? null) === Magento\Framework\View\LayoutFactory::class
                    && ($frame['function'] ?? null) === 'create');
            if (!$created) return;
            (new ReflectionProperty($layout, '____scope'))->setValue($layout, $scope);
            $replacements++;
        });
}
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
$area->load(Area::PART_CONFIG);
$area->load(Area::PART_DESIGN);
$cache = $objects->get(Magento\Framework\App\Cache\StateInterface::class);
foreach (['layout', 'block_html', 'full_page'] as $type) $cache->setEnabled($type, false);
if ($mode === 'unverified-scope') {
    $scope = new class($objects->get(Magento\Framework\App\AreaList::class), 'frontend') extends Magento\Framework\Config\Scope {
        public function getCurrentScope()
        {
            return parent::getCurrentScope();
        }
    };
}
$result = $objects->get(MageLens\Compatibility\Controller\Shared\Index::class)->execute();
$html = (new ReflectionProperty(Magento\Framework\Controller\Result\Raw::class, 'contents'))->getValue($result);
if (substr_count($html, 'data-layout-shared="second"') !== 4) throw new RuntimeException('Native shared fixture failed');
if ($mode === 'unverified-scope' && $replacements !== 2) throw new RuntimeException('Expected two optimized native layout scope replacements');
echo "Verified native reuse across two layouts and four renders of the second template.\n";
if (in_array('--native-only', $argv, true)) exit;
$limits = $collector->finish()[2];
if ($mode === 'unverified-scope' && !in_array('layout-block-registration-origin', $limits, true)) {
    throw new RuntimeException('Missing unverified native registration limitation');
}
$events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
foreach ($files as $index => $file) {
    foreach ($file['declarations'] as $declaration) {
        $kind = $declaration['layout']['kind'];
        if (!in_array($kind, ['block', 'template'], true)) continue;
        $actual = [];
        foreach ($events as $event) if ($event['id'] === $declaration['id']) $actual[$event['type']] = $event['hits'];
        $expected = $kind === 'block'
            ? ['layout-block-created' => 1, 'layout-block-render-origin-unconfirmed' => 2,
                ($mode === 'native' ? 'layout-block-rendered' : 'layout-block-registration-origin-unconfirmed') => 1]
            : ($index === 0 ? ['layout-template-selected' => 1, 'layout-template-replaced' => 1]
                : ['layout-template-selected' => 1, 'layout-template-executed' => 4]);
        ksort($actual);
        ksort($expected);
        if ($actual !== $expected) throw new RuntimeException('Shared block evidence differs for ' . $index . '/' . $kind);
    }
}
echo $mode === 'native'
    ? "Verified two independent layout render origins, two ambiguous direct calls and four executions of the second template.\n"
    : "Verified equal-valued unverified scope keeps construction and template facts with zero original layout render hits.\n";
