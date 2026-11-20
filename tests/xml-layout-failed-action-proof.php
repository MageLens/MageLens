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
$files = [];
foreach (['body', 'interpreter', 'partial', 'dispatch', 'type', 'denied', 'success'] as $case) {
    $path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_actionfailure_' . $case . '.xml';
    $source = file_get_contents(BP . '/' . $path);
    $files[] = ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
        'declarations' => LayoutManifest::declarations($path, $source)];
}
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
$missing = in_array($argv[1] ?? '', ['--missing-action-pre', '--missing-action-post', '--missing-evaluation-pre', '--missing-evaluation-post', '--missing-interpreter-pre', '--missing-interpreter-post'], true) ? $argv[1] : null;
$bound = in_array('--action-depth', $argv, true);
if ($bound && !in_array('--without-collector', $argv, true)) {
    (new ReflectionProperty($collector, 'actionEvaluations'))->setValue($collector, array_fill(0, 256, null));
}
if (!in_array('--without-collector', $argv, true)) foreach ($callbacks as [$class, $method, $pre, $post]) {
    $owner = $pre ?? $post;
    $interpreter = $owner instanceof Closure && (new ReflectionFunction($owner))->getClosureThis() instanceof MageLens\XmlCoverage\LayoutArgumentOwnership;
    if ($missing !== null && ((str_contains($missing, 'interpreter') && $interpreter)
        || (!str_contains($missing, 'interpreter') && $class === Magento\Framework\View\Layout\Generator\Block::class
            && $method === (str_contains($missing, 'evaluation') ? 'evaluateArguments' : 'generateAction')
            && $owner instanceof Closure && (new ReflectionFunction($owner))->getClosureThis() === $collector))) {
        if (str_ends_with($missing, '-pre')) $pre = null;
        else $post = null;
    }
    if (!LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot register failed action proof');
}
// The extension observes dispatch before PHP validates parameter types.
// These controls distinguish that boundary from executing the method body.
$dispatches = [];
foreach (['applyBeforeFailure' => RuntimeException::class, 'requireObject' => TypeError::class] as $method => $expectedError) {
    if (!OpenTelemetry\Instrumentation\hook(MageLens\Compatibility\Block\LayoutFailedAction::class, $method,
        static function ($block, array $params, string $class) use (&$dispatches, $method): void {
            $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 4);
            if (($trace[2]['function'] ?? '') !== 'call_user_func_array'
                || ($trace[3]['class'] ?? '') !== Magento\Framework\View\Layout\Generator\Block::class
                || ($trace[3]['function'] ?? '') !== 'generateAction') throw new RuntimeException('Native action dispatch caller changed');
            $dispatches[$method]['pre'] = ($dispatches[$method]['pre'] ?? 0) + 1;
        },
        static function ($block, array $params, $result, ?Throwable $error, string $class) use (&$dispatches, $method, $expectedError): void {
            if (!$error instanceof $expectedError) throw new RuntimeException('Native action dispatch failure changed');
            $dispatches[$method]['post'] = ($dispatches[$method]['post'] ?? 0) + 1;
        })) throw new RuntimeException('Cannot observe native failed action dispatch');
}
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
$area->load(Magento\Framework\App\Area::PART_CONFIG); $area->load(Magento\Framework\App\Area::PART_DESIGN);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$objects->get(Magento\Framework\App\ViewInterface::class);
$onlyPartial = in_array('--partial-only', $argv, true);
MageLens\Compatibility\Block\LayoutFailedAction::$onlyCase = $onlyPartial ? 'partial' : null;
$result = $objects->create(MageLens\Compatibility\Controller\Actionfailure\Index::class)->execute();
$response = $objects->create(Magento\Framework\App\Response\Http::class);
$result->renderResult($response);
foreach ($onlyPartial ? ['partial'] : ['body', 'interpreter', 'partial', 'dispatch', 'type', 'denied', 'success'] as $case) {
    if (!str_contains($response->getBody(), '<span data-layout-action-failure="' . $case . '">verified</span>')) throw new RuntimeException('Native failed action proof marker is missing');
}
foreach (['applyBeforeFailure', 'requireObject'] as $method) {
    if (($dispatches[$method] ?? []) !== ($onlyPartial ? [] : ['pre' => 1, 'post' => 1])) throw new RuntimeException('Native action dispatch observation is missing');
}
echo $onlyPartial ? "Verified native partial argument evaluation and unreached later values.\n"
    : "Verified native action evaluation, dispatch, body failure, type failure, denied and successful boundaries.\n";
if (!$onlyPartial) echo "Verified paired method hooks cannot distinguish body entry from rejected parameter types.\n";
if (in_array('--without-collector', $argv, true)) exit;
try { $state = $collector->finish(); }
catch (RuntimeException $error) {
    if (($missing === null && !$bound) || !preg_match('/action|argument/i', $error->getMessage())) throw $error;
    echo "Verified failed action publication rejection after unchanged native output.\n";
    exit;
}
if ($missing !== null || $bound) throw new RuntimeException('Incomplete failed action evidence was accepted');
$events = array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue());
$evidencePath = array_search('--evidence-file', $argv, true);
if ($evidencePath !== false) {
    $encoded = json_encode(['files' => $files,
        'layoutSources' => LayoutManifest::targets($files), 'layoutHook' => $state[0],
        'layoutSourceTrace' => $state[1], 'layoutLimitations' => $state[2], 'events' => $events], JSON_THROW_ON_ERROR);
    if (file_put_contents($argv[$evidencePath + 1], $encoded) !== strlen($encoded)) throw new RuntimeException('Cannot write bounded layout evidence');
    echo "Wrote bounded original-source proof evidence without response bytes.\n";
    exit;
}
foreach ($files as $file) {
    $case = substr(basename($file['path'], '.xml'), strlen('coverageprobe_actionfailure_'));
    foreach ($file['declarations'] as $item) {
        $kind = $item['layout']['kind'];
        if (!in_array($kind, ['action', 'action-method', 'action-argument', 'action-argument-name'], true)) continue;
        $first = str_contains($item['node'], '/action[1]');
        $active = !$onlyPartial || $case === 'partial';
        $success = $active && ($first ? $case === 'success' : in_array($case, ['success', 'denied'], true));
        $failed = $active && $first && !in_array($case, ['success', 'denied'], true);
        if (in_array($kind, ['action', 'action-method'], true)) {
            $expected = $success ? ['layout-action-executed'] : ($failed ? ['layout-action-' . (in_array($case, ['interpreter', 'partial'], true) ? 'evaluation-failed' : 'completion-failed')] : []);
        } else {
            $family = $kind === 'action-argument' ? 'argument' : 'argument-name';
            $expected = $success ? ['layout-action-' . $family . '-applied'] : ($failed
                ? ['layout-action-' . $family . (in_array($case, ['interpreter', 'partial'], true) && !($case === 'partial' && str_contains($item['node'], '/argument[1]')) ? '-evaluation-incomplete' : '-evaluated')] : []);
        }
        $types = array_values(array_unique(array_column(array_filter($events, static fn($event) => $event['id'] === $item['id']), 'type')));
        if ($types !== $expected) throw new RuntimeException('Original failed action boundaries differ from native evidence');
    }
}
echo "Verified separate original action failures, evaluated values and untouched later calls.\n";
