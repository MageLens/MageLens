<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
$_SERVER['REQUEST_URI'] = '/coverageprobe/sharedactions/';
require '/var/www/html/app/bootstrap.php';
$hooks = dirname(getenv('MAGELENS_XML_HOOKS') ?: (require __DIR__ . '/project-root.php') . '/docker/php/xml-hooks.php');
require $hooks . '/xml-hooks.php';
require $hooks . '/xml-layout-manifest.php';
use MageLens\XmlCoverage\{LayoutCoverage, LayoutManifest, LayoutRuntimeHooks, Recorder};
$case = in_array($argv[1] ?? '', ['unguarded', 'distinct'], true) ? $argv[1] : 'guarded';
$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_sharedactions' . ($case === 'guarded' ? '' : '_' . $case) . '.xml';
$source = file_get_contents(BP . '/' . $path);
$files = [['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
    'declarations' => LayoutManifest::declarations($path, $source)]];
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
$missing = in_array('--missing-snapshot', $argv, true) ? 'snapshot' : (in_array('--missing-process', $argv, true) ? 'process' : null);
$bound = in_array('--alias-limit', $argv, true) ? 'aliases' : (in_array('--binding-limit', $argv, true) ? 'bindings' : null);
if (!in_array('--without-collector', $argv, true)) foreach ($callbacks as [$class, $method, $pre, $post]) {
    if (($missing === 'snapshot' && $class === Magento\Framework\View\Layout\ScheduledStructure::class && $method === 'getElements')
        || ($missing === 'process' && $method === 'process' && $pre
            && (new ReflectionFunction($pre))->getClosureThis() instanceof MageLens\XmlCoverage\LayoutActionGuards)) continue;
    if (!LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot register shared action proof');
}
if ($bound !== null && !in_array('--without-collector', $argv, true)) {
    $guards = (new ReflectionProperty(LayoutCoverage::class, 'actionGuards'))->getValue($collector);
    OpenTelemetry\Instrumentation\hook(Magento\Framework\View\Layout\Generator\Block::class, 'generateBlock', null,
        static function ($generator, array $params, $block, ?Throwable $error, string $class) use ($guards, $bound): void {
            if ($error || $class !== Magento\Framework\View\Layout\Generator\Block::class
                || ($params[2] ?? null) !== 'magelens.shared.action.allowed') return;
            $property = new ReflectionProperty($guards, 'processing');
            $frames = $property->getValue($guards); $index = array_key_last($frames);
            if ($index === null) throw new RuntimeException('Missing native action process for bound control');
            $empty = ['safe' => false, 'context' => null, 'calls' => []];
            if ($bound === 'aliases') {
                $aliases = [];
                for ($number = 0; $number < 128; $number++) {
                    $name = 'fixture.bound.' . $number;
                    $aliases[$name] = true; $frames[$index]['bindings'][$name] = $empty;
                }
                $frames[$index]['objects'][$block] = $aliases;
            } else {
                for ($number = 0; count($frames[$index]['bindings']) < 8192; $number++) {
                    $frames[$index]['bindings']['fixture.bound.' . $number] = $empty;
                }
            }
            $property->setValue($guards, $frames);
        });
}
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
$area->load(Magento\Framework\App\Area::PART_CONFIG); $area->load(Magento\Framework\App\Area::PART_DESIGN);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$objects->get(Magento\Framework\App\ViewInterface::class);
$objects->get(Magento\Framework\App\RequestInterface::class)->setParam('case', $case);
$result = $objects->create(MageLens\Compatibility\Controller\Sharedactions\Index::class)->execute();
$response = $objects->create(Magento\Framework\App\Response\Http::class);
$result->renderResult($response);
if (!str_contains($response->getBody(), '<span data-layout-shared-action-proof data-layout-shared-action-case="' . $case . '">verified</span>')) throw new RuntimeException('Native shared action proof marker is missing');
echo "Verified native shared object aliases and exact action calls for $case.\n";
if (in_array('--without-collector', $argv, true)) exit;
try {
    $state = $collector->finish();
} catch (RuntimeException $error) {
    $expected = $bound === 'aliases' ? 'aliases exceeded 128' : ($bound === 'bindings' ? 'bindings exceeded 8192' : ($missing !== null ? 'native action guard' : null));
    if ($expected === null || !str_contains($error->getMessage(), $expected)) throw $error;
    echo "Verified shared action publication rejection for the missing observation or bound.\n";
    exit;
}
if ($bound !== null || $missing !== null) throw new RuntimeException('Incomplete shared action attribution was accepted');
$events = array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue());
$evidencePath = array_search('--evidence-file', $argv, true);
if ($evidencePath !== false) {
    file_put_contents($argv[$evidencePath + 1], json_encode(['files' => $files,
        'layoutSources' => LayoutManifest::targets($files), 'layoutHook' => $state[0],
        'layoutSourceTrace' => $state[1], 'layoutLimitations' => $state[2], 'events' => $events], JSON_THROW_ON_ERROR));
    echo "Wrote bounded original-source proof evidence without response bytes.\n";
    exit;
}
foreach ($files[0]['declarations'] as $item) {
    if (!in_array($item['layout']['kind'], ['action', 'action-method'], true)) continue;
    $types = array_values(array_unique(array_column(array_filter($events, static fn($event) => $event['id'] === $item['id']), 'type')));
    $expected = $case === 'unguarded' ? ['layout-action-ambiguous']
        : ($case === 'guarded' && str_contains($item['node'], 'block[2]') ? [] : ['layout-action-executed']);
    if ($types !== $expected) throw new RuntimeException('Original shared action call or method ownership differs from its native slot');
}
echo "Verified original shared action/method effects and exact ambiguous/zero-hit cases.\n";
