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


$mode = str_starts_with($argv[1] ?? '', '--') ? 'native' : ($argv[1] ?? 'native');
$missing = [
    'missing-process' => [Magento\Framework\View\Layout\Generator\Block::class, 'process'],
    'missing-snapshot' => [Magento\Framework\View\Layout\ScheduledStructure::class, 'getElements'],
    'missing-scope' => [Magento\Framework\App\ScopeResolverInterface::class, 'getScope'],
    'missing-flag' => [Magento\Framework\App\Config\ScopeConfigInterface::class, 'isSetFlag'],
];
$base = preg_replace('/-(pre|post)$/', '', $mode);
$depth = ['process-depth' => 'processing', 'snapshot-depth' => 'snapshots', 'scope-depth' => 'lookups', 'flag-depth' => 'flags'];
if (!in_array($mode, ['native', 'dynamic', 'custom-snapshot', 'snapshot-limit', 'delegated-flag', 'delegated-scope', 'failed-flag', 'unguarded', 'equal-write', 'guard-only', 'zero-hit', 'unvisited-scope'], true) && !isset($missing[$base]) && !isset($depth[$mode])) throw new RuntimeException('Unknown action guard proof mode');
$skipped = false;
$without = in_array('--without-collector', $argv, true);
$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_actionguards' . ($mode === 'unvisited-scope' ? '_never' : '') . '.xml';
$source = file_get_contents(BP . '/' . $path);
$declarations = LayoutManifest::declarations($path, $source);
if (in_array($mode, ['guard-only', 'zero-hit', 'unvisited-scope'], true)) {
    $declarations = [array_values(array_filter($declarations, static fn($item) => $item['layout']['attribute'] === 'ifconfig'
        && ($mode !== 'zero-hit' || str_contains($item['node'], 'referenceBlock'))))[0]];
}
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets([
    ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source), 'declarations' => $declarations],
]));
if (isset($depth[$mode])) {
    $guards = (new ReflectionProperty($collector, 'actionGuards'))->getValue($collector);
    (new ReflectionProperty($guards, $depth[$mode]))->setValue($guards, array_fill(0, 256, null));
}
foreach ($callbacks as [$class, $method, $pre, $post]) {
    if ($without) continue;
    $owner = $pre ?? $post;
    if (($missing[$base] ?? null) === [$class, $method] && $owner instanceof Closure
        && (new ReflectionFunction($owner))->getClosureThis() instanceof MageLens\XmlCoverage\LayoutActionGuards) {
        $skipped = true;
        if (str_ends_with($mode, '-pre')) $pre = null;
        elseif (str_ends_with($mode, '-post')) $post = null;
        else continue;
    }
    if (!OpenTelemetry\Instrumentation\hook($class, $method, $pre, $post)) throw new RuntimeException('Cannot register action guard hook');
}
$decisions = [];
$failedFlags = 0;
$unexpectedFailure = false;
$builders = [];
$layouts = [];
OpenTelemetry\Instrumentation\hook(Magento\Framework\App\Config\ScopeConfigInterface::class, 'isSetFlag', null,
    static function ($config, array $params, $result, ?Throwable $error, string $class) use (&$decisions, &$builders, &$layouts, &$failedFlags, &$unexpectedFailure): void {
        $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? [];
        if (($caller['class'] ?? '') !== Magento\Framework\View\Layout\Generator\Block::class
            || ($caller['function'] ?? '') !== 'process' || !str_starts_with($params[0] ?? '', 'magelens_layout_fixture/actions/')) return;
        if ($error) {
            $failedFlags++;
            $unexpectedFailure = $unexpectedFailure || $error->getMessage() !== 'MageLens action guard fixture failure';
            return;
        }
        $decisions[] = (bool) $result;
        foreach (debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS | DEBUG_BACKTRACE_PROVIDE_OBJECT, 24) as $frame) {
            if (!isset($frame['object'])) continue;
            if (($frame['class'] ?? '') === Magento\Framework\View\Layout\Builder::class && $frame['function'] === 'build') {
                $builders[spl_object_id($frame['object'])] = true;
            }
            if (($frame['class'] ?? '') === Magento\Framework\View\Layout::class && $frame['function'] === 'generateElements') {
                $layouts[spl_object_id($frame['object'])] = true;
            }
        }
    });
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
$area->load(Magento\Framework\App\Area::PART_CONFIG);
if ($mode === 'custom-snapshot') {
    class CustomActionGuardSchedule extends Magento\Framework\View\Layout\ScheduledStructure
    {
        public static int $calls = 0;
        public function getElements()
        {
            self::$calls++;
            return parent::getElements();
        }
    }
    OpenTelemetry\Instrumentation\hook(Magento\Framework\View\Layout\Reader\ContextFactory::class, 'create',
        static function ($factory, array $params): ?array {
            $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? [];
            $schedule = $params[0]['scheduledStructure'] ?? null;
            if (($caller['class'] ?? '') !== Magento\Framework\View\Layout::class
                || ($caller['function'] ?? '') !== 'createIsolatedReaderContext'
                || !$schedule instanceof Magento\Framework\View\Layout\ScheduledStructure) return null;
            return [[...$params[0], 'scheduledStructure' => new CustomActionGuardSchedule($schedule->__toArray())]];
        });
}
$area->load(Magento\Framework\App\Area::PART_DESIGN);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$objects->get(Magento\Framework\App\ViewInterface::class);
$fragment = $objects->get(Magento\Framework\View\Result\LayoutFactory::class)->create();
$fragment->addHandle('coverageprobe_actionguards');
if (in_array($mode, ['dynamic', 'snapshot-limit', 'unguarded'], true)) {
    $dynamicGuardPath = $mode === 'dynamic' ? 'magelens_layout_fixture/actions/allowed' : 'magelens_layout_fixture_limit/disabled';
    $action = '<action method="mark" ifconfig="' . $dynamicGuardPath . '"><argument name="marker" xsi:type="string">dynamic</argument></action>';
    if ($mode === 'unguarded') $action = '<action method="mark"><argument name="marker" xsi:type="string">dynamic</argument></action>';
    $fragment->addUpdate('<block class="MageLens\\Compatibility\\Block\\LayoutActionGuard" name="magelens.action.guard.dynamic">'
        . str_repeat($action, $mode === 'snapshot-limit' ? 8193 : 1) . '</block>');
}

$writes = 0;
if ($mode === 'equal-write') {
    OpenTelemetry\Instrumentation\hook(Magento\Framework\View\Layout\Generator\Block::class, 'process',
        static function ($generator, array $params, string $class) use (&$writes): void {
            if ($class !== Magento\Framework\View\Layout\Generator\Block::class) return;
            $schedule = $params[0]->getScheduledStructure();
            $element = $schedule->getElement('magelens.action.guard.allowed');
            if (!$element) throw new RuntimeException('Missing equal-write native fixture element');
            $schedule->setElement('magelens.action.guard.allowed', $element);
            $writes++;
        });
}
$layout = $fragment->getLayout();
if (in_array($mode, ['delegated-flag', 'delegated-scope', 'failed-flag'], true)) {
    $pool = (new ReflectionProperty(Magento\Framework\View\Layout::class, 'generatorPool'))->getValue($layout);
    $generator = $pool->getGenerator('block');
    if ($mode === 'delegated-scope') {
        class DelegatedActionGuardScope implements Magento\Framework\App\ScopeResolverInterface
        {
            public function __construct(private Magento\Framework\App\ScopeResolverInterface $original) {}
            public function getScope($scopeId = null) { return $this->original->getScope($scopeId); }
            public function getScopes() { return $this->original->getScopes(); }
        }
        $dependency = new ReflectionProperty(Magento\Framework\View\Layout\Generator\Block::class, 'scopeResolver');
        $dependency->setValue($generator, new DelegatedActionGuardScope($dependency->getValue($generator)));
    } else {
        class DelegatedActionGuardConfig implements Magento\Framework\App\Config\ScopeConfigInterface
        {
            public function __construct(private Magento\Framework\App\Config\ScopeConfigInterface $original, private bool $fail) {}
            public function getValue($path = null, $scopeType = self::SCOPE_TYPE_DEFAULT, $scopeCode = null)
            {
                return $this->original->getValue($path, $scopeType, $scopeCode);
            }
            public function isSetFlag($path, $scopeType = self::SCOPE_TYPE_DEFAULT, $scopeCode = null)
            {
                if ($this->fail && $path === 'magelens_layout_fixture/actions/allowed') throw new RuntimeException('MageLens action guard fixture failure');
                return $this->original->isSetFlag($path, $scopeType, $scopeCode);
            }
        }
        $dependency = new ReflectionProperty(Magento\Framework\View\Layout\Generator\Block::class, 'scopeConfig');
        $dependency->setValue($generator, new DelegatedActionGuardConfig($dependency->getValue($generator), $mode === 'failed-flag'));
    }
}
if ($mode === 'failed-flag') {
    $failure = null;
    try { $failedBlock = $layout->getBlock('magelens.action.guard.allowed'); }
    catch (RuntimeException $error) { $failure = $error; }
    $production = $objects->get(Magento\Framework\App\State::class)->getMode() === Magento\Framework\App\State::MODE_PRODUCTION;
    if ($production ? ($failure !== null || !$failedBlock instanceof Magento\Framework\View\Element\ExceptionHandlerBlock)
        : ($failure?->getMessage() !== 'MageLens action guard fixture failure')) throw new RuntimeException('Native action guard failure handling changed');
    $expectedFailures = $production && $objects->get(Magento\Framework\Module\ModuleListInterface::class)->has('MageOS_Seo') ? 2 : 1;
    if ($unexpectedFailure || $failedFlags !== $expectedFailures) throw new RuntimeException('Native guard failure count or exception differs');
    echo "Verified native action guard failure handling.\n";
    if ($without) exit;
    $collector->finish();
    $id = array_values(array_filter($declarations, static fn($item) => $item['node'] === '/layout/container/block[1]/action/@ifconfig'))[0]['id'];
    $events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
    $types = array_values(array_unique(array_column(array_filter($events, static fn($event) => $event['id'] === $id), 'type')));
    if ($types !== ['layout-action-condition-failed']) throw new RuntimeException('Native failed guard was credited as a decision');
    if (!$production) {
        foreach ($declarations as $item) {
            if ($item['layout']['attribute'] !== 'ifconfig' || $item['id'] === $id || str_contains($item['node'], 'referenceBlock')) continue;
            $types = array_values(array_unique(array_column(array_filter($events, static fn($event) => $event['id'] === $item['id']), 'type')));
            if ($types !== ['layout-action-condition-unobserved']) throw new RuntimeException('Aborted guard was credited as observed');
        }
    }
    echo "Verified original failed guard without decision or call credit.\n";
    exit;
}

foreach (['allowed' => ['allowed'], 'denied' => [], 'duplicate' => ['first', 'second'],
    'empty' => ['empty'], 'zero' => ['zero'], 'same' => ['same']] as $case => $expected) {
    $block = $layout->getBlock('magelens.action.guard.' . $case);
    if (!$block || $block->markers() !== $expected) throw new RuntimeException('Native action guard changed: ' . $case);
}
$beforeOutput = count($decisions);
$beforeBlock = $layout->getBlock('magelens.action.guard.allowed');
$html = $layout->getOutput();
$buildCount = $objects->get(Magento\Framework\Module\ModuleListInterface::class)->has('MageOS_Seo') ? 2 : 1;
$nativeDecisions = [true, false, true, true, true, false];
if ($mode === 'dynamic') array_unshift($nativeDecisions, true);
$expectedDecisions = array_merge(...array_fill(0, $buildCount, $nativeDecisions));
if (substr_count($html, 'data-layout-action-case=') !== 6 || $layout->getBlock('magelens.action.guard.missing')
    || $unexpectedFailure || $failedFlags !== 0 || $beforeOutput !== count($expectedDecisions)
    || $decisions !== $expectedDecisions || count($builders) !== $buildCount || count($layouts) !== 1) throw new RuntimeException('Native action guard traversal changed: markers=' . substr_count($html, 'data-layout-action-case=') . ', beforeOutput=' . $beforeOutput . ', sameBlock=' . (int) ($beforeBlock === $layout->getBlock('magelens.action.guard.allowed')) . ', decisions=' . json_encode($decisions));
if ($mode === 'equal-write' && $writes !== $buildCount) throw new RuntimeException('Native equal-write fixture did not run');
$decisionCount = count($nativeDecisions);
echo "Verified $buildCount native layout builds with $decisionCount guard decisions each, short circuits, identical calls and absent targets.\n";
if ($mode === 'custom-snapshot') {
    if (CustomActionGuardSchedule::$calls === 0) throw new RuntimeException('Custom schedule was not used');
    echo 'Native action schedule reads: ', CustomActionGuardSchedule::$calls, "\n";
    $expected = array_search('--expected-reads', $argv, true);
    if ($expected !== false && CustomActionGuardSchedule::$calls !== (int) $argv[$expected + 1]) throw new RuntimeException('Collector invoked extra action schedule getters');
}
if ($without) exit;
try {
    $collectorState = $collector->finish();
} catch (RuntimeException $error) {
    $expected = isset($depth[$mode]) ? 'nesting exceeded 256' : ($mode === 'snapshot-limit' ? 'snapshot exceeded 8192' : (isset($missing[$base]) ? 'native action guard' : null));
    if ($expected === null || !str_contains($error->getMessage(), $expected) || (isset($missing[$base]) && !$skipped)) throw $error;
    echo "Verified native action guard publication rejection for $mode.\n";
    exit;
}
if (isset($missing[$base]) || isset($depth[$mode]) || $mode === 'snapshot-limit') throw new RuntimeException('Incomplete native guard evidence was accepted');
$events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
if (in_array($mode, ['guard-only', 'zero-hit', 'unvisited-scope'], true)) {
    if (!$collectorState[0] || $collectorState[1] !== ($mode !== 'unvisited-scope')) {
        throw new RuntimeException('Native hook health or active source trace differs for isolated guard inventory');
    }
}
if (in_array($mode, ['zero-hit', 'unvisited-scope'], true)) {
    if ($events !== []) throw new RuntimeException('An unvisited guard received native evidence');
    if ($mode === 'unvisited-scope' && !in_array('missing-layout-origins', $collectorState[2], true)) {
        throw new RuntimeException('Missing explicit origin limitation for wholly unselected source handles');
    }
    echo "Verified healthy zero-hit guard inventory and the exact active-origin boundary for $mode.\n";
    exit;
}
foreach ([
    '/layout/container/block[1]/action' => 'allowed',
    '/layout/container/block[2]/action' => 'denied',
    '/layout/container/block[3]/action[1]' => 'ambiguous',
    '/layout/container/block[3]/action[2]' => 'ambiguous',
    '/layout/container/block[4]/action' => 'empty-ignored',
    '/layout/container/block[5]/action' => 'empty-ignored',
    '/layout/container/block[6]/action[1]' => 'allowed',
    '/layout/container/block[6]/action[2]' => 'denied',
    '/layout/referenceBlock/action' => null,
] as $node => $effect) {
    if ($effect !== null && $mode === 'custom-snapshot') $effect = 'origin-unconfirmed';
    if ($mode === 'dynamic' && $node === '/layout/container/block[1]/action') $effect = 'ambiguous';
    if ($mode === 'equal-write' && $node === '/layout/container/block[1]/action') $effect = 'origin-unconfirmed';
    $matches = array_values(array_filter($declarations, static fn($item) => $item['node'] === $node . '/@ifconfig'));
    if ($mode === 'guard-only' && !$matches) continue;
    $origin = $matches[0];
    $types = array_values(array_unique(array_column(array_filter($events, static fn($event) => $event['id'] === $origin['id']), 'type')));
    if ($types !== ($effect === null ? [] : ['layout-action-condition-' . $effect])) {
        throw new RuntimeException('Missing original native action guard evidence for ' . $node);
    }
}
echo "Verified independent original action condition provenance.\n";
