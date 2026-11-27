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
use Magento\Framework\View\Layout\ScheduledStructure;
use Magento\Framework\View\Layout\Data\Structure;
use Magento\Framework\View\Layout\GeneratorPool;
use Magento\Framework\View\Layout\Reader\Move;

$mode = $argv[1] ?? 'native';
if (!in_array($mode, ['native', 'programmatic', 'same', 'unchanged', 'sibling-missing', 'alias-fallback', 'overridden', 'hooked-storage', 'custom-getter', 'missing-writer', 'missing-order', 'missing-execution', 'missing-list', 'missing-reader', 'reader-depth', 'execution-depth', 'missing-reader-entry', 'missing-reader-end', 'missing-order-pre', 'missing-order-post', 'missing-execution-pre', 'missing-execution-post', 'missing-schedule-pre', 'missing-schedule-post', 'custom-structure', 'interpret-depth'], true)) throw new RuntimeException('Unknown move proof');
$variant = in_array($mode, ['programmatic', 'same', 'unchanged', 'sibling-missing', 'alias-fallback', 'overridden'], true) ? $mode : 'after';
$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_moveoperands_' . $variant . '.xml';
$source = file_get_contents(BP . '/' . $path);
$declarations = LayoutManifest::declarations($path, $source);
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets([
    ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source), 'declarations' => $declarations],
]));
if ($mode === 'interpret-depth') {
    (new ReflectionProperty($collector, 'moveReaders'))->setValue($collector,
        array_fill(0, 256, ['xml' => null, 'observed' => 0]));
} elseif ($mode === 'reader-depth') {
    (new ReflectionProperty($collector, 'moveReads'))->setValue($collector,
        array_fill(0, 256, ['schedule' => null, 'name' => '', 'ids' => [], 'context' => null]));
} elseif ($mode === 'execution-depth') {
    (new ReflectionProperty($collector, 'moving'))->setValue($collector,
        array_fill(0, 256, ['structure' => null, 'name' => '', 'before' => null, 'ordered' => false]));
}
foreach ($callbacks as [$class, $method, $pre, $post]) {
    if (in_array('--without-collector', $argv, true)) continue;
    if ($mode === 'missing-reader' && [$class, $method] === [Move::class, 'scheduleMove']) continue;
    if ($mode === 'missing-execution' && [$class, $method] === [GeneratorPool::class, 'moveElementInStructure']) continue;
    if ($mode === 'missing-list' && [$class, $method] === [ScheduledStructure::class, 'getListToMove']) continue;
    if ($mode === 'missing-writer' && [$class, $method] === [ScheduledStructure::class, 'setElementToMove']) continue;
    if ($mode === 'missing-order' && [$class, $method] === [Structure::class, 'reorderChildElement']) continue;
    if ($mode === 'missing-reader-entry' && [$class, $method] === [Move::class, 'interpret']) $pre = null;
    if ($mode === 'missing-reader-end' && [$class, $method] === [Move::class, 'interpret']) $post = null;
    $owner = ($pre ?? $post) instanceof Closure ? (new ReflectionFunction($pre ?? $post))->getClosureThis() : null;
    if (in_array($mode, ['missing-order-pre', 'missing-order-post'], true)
        && $owner instanceof LayoutCoverage && [$class, $method] === [Structure::class, 'reorderChildElement']) {
        if ($mode === 'missing-order-pre') $pre = null; else $post = null;
    }
    if (in_array($mode, ['missing-execution-pre', 'missing-execution-post'], true) && [$class, $method] === [GeneratorPool::class, 'moveElementInStructure']) {
        if ($mode === 'missing-execution-pre') $pre = null; else $post = null;
    }
    if (in_array($mode, ['missing-schedule-pre', 'missing-schedule-post'], true) && [$class, $method] === [Move::class, 'scheduleMove']) {
        if ($mode === 'missing-schedule-pre') $pre = null; else $post = null;
    }
    if (!\MageLens\XmlCoverage\LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot register native move proof hook');
}
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
$area->load(Area::PART_CONFIG);
$area->load(Area::PART_DESIGN);
$cache = $objects->get(Magento\Framework\App\Cache\StateInterface::class);
foreach (['layout', 'block_html', 'full_page'] as $type) $cache->setEnabled($type, false);
if ($mode === 'hooked-storage') {
    $replacement = new class extends ScheduledStructure {
        public static int $reads = 0;
        protected $scheduledMoves {
            &get {
                self::$reads++;
                return $this->scheduledMoves;
            }
        }
    };
    $objects->configure(['preferences' => [ScheduledStructure::class => get_class($replacement)]]);
} elseif ($mode === 'custom-getter') {
    $replacement = new class extends ScheduledStructure {
        public static int $reads = 0;
        public function getElementToMove($elementName, $default = null)
        {
            self::$reads++;
            return parent::getElementToMove($elementName, $default);
        }
    };
    $objects->configure(['preferences' => [ScheduledStructure::class => get_class($replacement)]]);
}
if ($mode === 'custom-structure') {
    $structureReplacement = new class($objects->get(Psr\Log\LoggerInterface::class), $objects->get(Magento\Framework\App\State::class)) extends Structure {
        public static int $reads = 0;
        public function setAsChild($elementId, $parentId, $alias = '', $position = null)
        {
            if ($elementId === 'magelens.layout.moveoperand.movable' && $parentId === 'magelens.layout.moveoperand.right') {
                self::$reads++;
                $elementId = 'magelens.layout.moveoperand.movable';
                $parentId = 'magelens.layout.moveoperand.right';
                $alias = 'moved-alias';
            }
            parent::setAsChild($elementId, $parentId, $alias, $position);
        }
    };
    // Compiled factories can resolve argument types before runtime preference
    // changes. Supply this test object at the actual native constructor input.
    OpenTelemetry\Instrumentation\hook(Magento\Framework\View\Layout::class, '__construct',
        static function ($layout, array $params, string $class) use ($structureReplacement): ?array {
            return $class === Magento\Framework\View\Layout::class ? [2 => $structureReplacement] : null;
        });

}
if (isset($replacement)) {
    // Layout's isolated copy constructs ScheduledStructure directly. Preserve
    // the fixture subclass at that real consumer as well as at the reader.
    OpenTelemetry\Instrumentation\hook(Magento\Framework\View\Layout\Reader\Context::class, '__construct', null,
        static function ($context) use ($replacement): void {
            $property = new ReflectionProperty(Magento\Framework\View\Layout\Reader\Context::class, 'scheduledStructure');
            $schedule = $property->getRawValue($context);
            if ($schedule instanceof $replacement) return;
            $type = get_class($replacement);
            $property->setValue($context, new $type($schedule->__toArray()));
        });
}
$objects->get(Magento\Framework\App\RequestInterface::class)->setParam('case', $variant);
$actualSchedule = null;
OpenTelemetry\Instrumentation\hook(ScheduledStructure::class, 'setElementToMove', null,
    static function ($schedule, array $params) use (&$actualSchedule): void {
        if ($params[0] === 'magelens.layout.moveoperand.movable') $actualSchedule = $schedule;
    });
$result = $objects->get(MageLens\Compatibility\Controller\Moves\Index::class)->execute();
$response = $objects->get(Magento\Framework\App\ResponseInterface::class);
$result->renderResult($response);
if (substr_count($response->getBody(), 'data-layout-moveoperand') !== 3) throw new RuntimeException('Native move HTTP result failed');
echo "Verified native move structure and rendered result.\n";
if (isset($structureReplacement)) {
    if ($structureReplacement::$reads !== 1) throw new RuntimeException('Native move did not use the equal-valued structure replacement');
    echo 'Verified equal-valued native structure setter replacement.' . "\n";
}
if (isset($replacement)) {
    if (!$actualSchedule instanceof $replacement) throw new RuntimeException('Native move did not use the replacement schedule');
    if ($replacement::$reads < 1) throw new RuntimeException('Native move never exercised the replacement getter or storage');
    $expectedIndex = array_search('--expected-reads', $argv, true);
    if ($expectedIndex !== false && $replacement::$reads !== (int) ($argv[$expectedIndex + 1] ?? -1)) {
        throw new RuntimeException('Coverage added native move storage or getter reads');
    }
    echo 'Native move storage/getter reads: ' . $replacement::$reads . "\n";
}

if (in_array('--native-only', $argv, true) || in_array('--without-collector', $argv, true)) exit;
try {
    $collector->finish();
} catch (RuntimeException $error) {
    $expected = ['missing-writer' => 'Missing native move scheduling hook evidence', 'missing-order' => 'Missing native move ordering hook evidence', 'missing-execution' => 'Missing native move execution hook evidence', 'missing-list' => 'Missing native move list hook evidence', 'missing-reader' => 'Missing native move reader hook evidence', 'missing-reader-entry' => 'Missing native move reader entry hook evidence', 'missing-reader-end' => 'Unbalanced native move hook evidence', 'missing-order-pre' => 'Missing native move ordering hook evidence', 'missing-order-post' => 'Missing native move ordering hook evidence', 'missing-execution-pre' => 'Missing native move execution hook evidence', 'missing-execution-post' => 'Unbalanced native move hook evidence', 'missing-schedule-pre' => 'Missing native move reader hook evidence', 'missing-schedule-post' => 'Unbalanced native move hook evidence', 'interpret-depth' => 'Native move interpretation tracking exceeded 256 frames', 'reader-depth' => 'Native move reader tracking exceeded 256 frames', 'execution-depth' => 'Native move execution tracking exceeded 256 frames'][$mode] ?? null;
    if ($expected === null || !str_contains($error->getMessage(), $expected)) throw $error;
    echo "Verified missing or bounded native move observation blocks publication.\n";
    exit;
}
if (str_starts_with($mode, 'missing-') || str_ends_with($mode, '-depth')) throw new RuntimeException('Missing native move observation was accepted');
$events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
foreach ($declarations as $declaration) {
    if (!str_starts_with($declaration['layout']['kind'], 'move')) continue;
    $expected = in_array($mode, ['hooked-storage', 'custom-getter', 'custom-structure'], true) ? 'origin-unconfirmed' : (in_array($mode, ['programmatic', 'overridden'], true) ? ($mode === 'programmatic' ? 'replaced' : 'overridden') : match ($declaration['layout']['attribute']) {
        'as' => 'alias-applied', 'after' => 'order-applied', default => 'applied',
    });
    if ($mode === 'same' && $declaration['layout']['attribute'] === 'destination') $expected = 'unchanged';
    if ($mode === 'unchanged' && in_array($declaration['layout']['attribute'], [null, 'element', 'destination'], true)) $expected = 'unchanged';
    if ($mode === 'unchanged' && $declaration['layout']['attribute'] === 'as') $expected = 'alias-unchanged';
    if (in_array($mode, ['same', 'unchanged', 'sibling-missing'], true) && $declaration['layout']['attribute'] === 'after') $expected = 'order-unchanged';
    $actual = [];
    foreach ($events as $event) if ($event['id'] === $declaration['id']) $actual[$event['type']] = $event['hits'];
    if ($actual !== ['layout-move-' . $expected => 1]) throw new RuntimeException('Unexpected move source evidence: ' . $declaration['node']);
}
echo "Verified original move operands and equal-valued replacement evidence.\n";
