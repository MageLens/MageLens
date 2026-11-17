<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\Data\Structure as DataStructure;
use Magento\Framework\View\Layout;
use Magento\Framework\View\Layout\Generator\Block as BlockGenerator;
use Magento\Framework\View\Layout\Generator\Container as ContainerGenerator;
use Magento\Framework\View\Layout\Generator\UiComponent as UiGenerator;
use Magento\Framework\View\Layout\Reader\Block as BlockReader;
use Magento\Framework\View\Layout\Reader\Container as ContainerReader;
use Magento\Framework\View\Layout\Reader\UiComponent as UiReader;
use Magento\Framework\View\Layout\ScheduledStructure;
use Magento\Framework\View\Layout\ScheduledStructure\Helper;
use Magento\Framework\View\Layout\GeneratorPool;
use Magento\Framework\View\Layout\ConfigCondition;
use Magento\Framework\View\Layout\AclCondition;
use Magento\Framework\View\Layout\Reader\Visibility\Condition as ConditionReader;
use Magento\Framework\View\Layout\Condition\Condition;
use Magento\Ui\Component\Wrapper\UiComponent as UiWrapper;

final class LayoutStructureCoverage
{
    private \WeakMap $scheduled;
    private \WeakMap $structures;
    private array $generating = [];
    private array $wrapping = [];
    private \WeakMap $components;
    private array $cacheability = [];
    private \WeakMap $conditionNodes;
    private array $visibility = [];
    private array $conditions = [];

    public function __construct(private readonly \Closure $origin)
    {
        $this->scheduled = new \WeakMap();
        $this->structures = new \WeakMap();
        $this->components = new \WeakMap();
        $this->conditionNodes = new \WeakMap();
    }

    public function hooks(): array
    {
        return [
            [ConditionReader::class, 'parseConditions', null, $this->parseConditions(...)],
            [GeneratorPool::class, 'buildStructure', $this->beginVisibility(...), $this->endVisibility(...)],
            [ScheduledStructure::class, 'getElements', null, $this->visibilityElements(...)],
            [GeneratorPool::class, 'visibilityConditionsExistsIn', null, $this->selectConditions(...)],
            [Condition::class, 'isVisible', $this->beginConditions(...), $this->endConditions(...)],
            [ConfigCondition::class, 'isVisible', null, $this->conditionDecision(...)],
            [AclCondition::class, 'isVisible', null, $this->conditionDecision(...)],
            [ContainerReader::class, 'mergeContainerAttributes', null, $this->scheduleContainer(...)],
            [BlockReader::class, 'scheduleBlock', null, $this->scheduleDisplay(...)],
            [BlockReader::class, 'scheduleReference', null, $this->scheduleDisplay(...)],
            [UiReader::class, 'interpret', null, $this->scheduleUi(...)],
            [ContainerGenerator::class, 'process', $this->beginGeneration(...), $this->endGeneration(...)],
            [BlockGenerator::class, 'process', $this->beginGeneration(...), $this->endGeneration(...)],
            [UiGenerator::class, 'process', $this->beginGeneration(...), $this->endGeneration(...)],
            [UiGenerator::class, 'generateComponent', null, $this->createUi(...)],
            [UiWrapper::class, '_toHtml', null, $this->renderUi(...)],
            [ContainerGenerator::class, 'generateContainer', null, $this->createContainer(...)],
            [DataStructure::class, 'setAttribute', null, $this->assignAttribute(...)],
            [DataStructure::class, 'createElement', null, $this->replaceElement(...)],
            [DataStructure::class, 'importElements', null, $this->replaceStructure(...)],
            [ScheduledStructure::class, 'setStructureElementData', null, $this->replaceSchedule(...)],
            [ScheduledStructure::class, 'setElement', null, $this->replaceSchedule(...)],
            [DataStructure::class, 'getAttribute', null, $this->readAttribute(...)],
            [Layout::class, '_renderContainer', $this->beginWrapper(...), $this->endWrapper(...)],
            [Layout::class, 'displayElement', null, $this->display(...)],
            [Layout::class, 'isCacheable', $this->beginCacheability(...), $this->endCacheability(...)],
            [Layout\Element::class, 'getBlockName', null, $this->cacheableBlock(...)],
            [DataStructure::class, 'hasElement', null, $this->cacheableTarget(...)],
        ];
    }

    public function snapshot(ScheduledStructure $schedule): array
    {
        return $this->scheduled[$schedule] ?? [];
    }

    public function restore(ScheduledStructure $schedule, array $state): void
    {
        $this->scheduled[$schedule] = $state;
    }

    public function reset(ScheduledStructure $schedule): void
    {
        unset($this->scheduled[$schedule]);
    }

    private static function caller(object $object, string $method): array
    {
        $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 5);
        $caller = $trace[3] ?? [];
        $wrapper = get_class($object);
        if (str_ends_with($wrapper, '\\Interceptor') && ($caller['class'] ?? null) === $wrapper
            && ($caller['function'] ?? null) === $method) return $trace[4] ?? [];
        return $caller;
    }

    private function scheduleContainer($reader, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== ContainerReader::class) return;
        [$schedule, $xml] = $params;
        $name = $xml->getAttribute('name');
        if ($name === '') return;
        [$ids, $context] = ($this->origin)($xml);
        $state = $this->snapshot($schedule);
        $entry = $xml->getName() === 'container' ? [] : ($state[$name] ?? []);
        if ($xml->getName() === 'container' && isset($ids['container'])) {
            $entry['container'] = ['id' => $ids['container'], 'context' => $context];
        }
        $attributes = $schedule->getStructureElementData($name, [])['attributes'] ?? [];
        foreach (['htmlTag', 'htmlId', 'htmlClass', 'display'] as $attribute) {
            if (!isset($xml[$attribute])) continue;
            $previous = $entry['attributes'][$attribute] ?? null;
            unset($entry['attributes'][$attribute]);
            if ($previous) $entry['overridden'][$previous['id']] = $previous;
            if (isset($ids['container-' . $attribute]) && ($attributes[$attribute] ?? null) === (string) $xml[$attribute]) {
                $entry['attributes'][$attribute] = ['id' => $ids['container-' . $attribute], 'context' => $context];
            }
        }
        $state[$name] = $entry;
        $this->restore($schedule, $state);
    }

    private function scheduleDisplay($reader, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== BlockReader::class) return;
        [$schedule, $xml] = $params;
        $name = $xml->getAttribute('name');
        $state = $this->snapshot($schedule);
        if ($xml->getName() === 'block') unset($state[$name]);
        [$ids, $context] = ($this->origin)($xml);
        if (isset($xml['display'])) {
            unset($state[$name]['attributes']['display']);
            if (isset($ids['block-display'])) $state[$name]['attributes']['display'] = ['id' => $ids['block-display'], 'context' => $context];
        }
        if ($xml->getName() === 'block' && isset($this->conditionNodes[$xml])) {
            $state[$name]['conditions'] = $this->conditionNodes[$xml];
        }
        $this->restore($schedule, $state);
    }

    private function beginGeneration($generator, array $params, string $class): void
    {
        if (!in_array($class, [ContainerGenerator::class, BlockGenerator::class, UiGenerator::class], true)) return;
        $this->generating[] = ['state' => $this->snapshot($params[0]->getScheduledStructure()),
            'structure' => $params[1]->getStructure()];
    }

    private function replaceElement($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== DataStructure::class) return;
        $state = $this->structures[$structure] ?? [];
        unset($state[$params[0]]);
        $this->structures[$structure] = $state;
    }

    private function replaceStructure($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class === DataStructure::class) unset($this->structures[$structure]);
    }

    private function replaceSchedule($schedule, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== ScheduledStructure::class) return;
        $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 2);
        $caller = self::caller($schedule, $trace[1]['function']);
        if (in_array([$caller['class'] ?? '', $caller['function'] ?? ''], [
            [ContainerReader::class, 'mergeContainerAttributes'],
            [BlockReader::class, 'scheduleBlock'],
            [BlockReader::class, 'scheduleReference'],
            [Helper::class, 'scheduleElement'],
            [UiReader::class, 'interpret'],
        ], true)) return;
        $state = $this->snapshot($schedule);
        unset($state[$params[0]]);
        $this->restore($schedule, $state);
    }

    private function endGeneration($generator, array $params, $result, ?\Throwable $error, string $class): void
    {
        if (in_array($class, [ContainerGenerator::class, BlockGenerator::class, UiGenerator::class], true)) array_pop($this->generating);
    }

    private function scheduleUi($reader, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== UiReader::class) return;
        [$context, $xml] = $params;
        $schedule = $context->getScheduledStructure();
        $state = $this->snapshot($schedule);
        $name = $xml->getAttribute('name');
        unset($state[$name]);
        [$ids, $scope] = ($this->origin)($xml);
        if (isset($ids['ui-placement'])) $state[$name]['ui'] = ['id' => $ids['ui-placement'], 'context' => $scope];
        if (isset($this->conditionNodes[$xml])) $state[$name]['conditions'] = $this->conditionNodes[$xml];
        $this->restore($schedule, $state);
    }

    private static function signature(array $data): ?string
    {
        return Xml::scalarTreeSignature($data);
    }

    private function parseConditions($reader, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== ConditionReader::class || !is_array($result)) return;
        $xml = $params[0];
        [$ids, $context] = ($this->origin)($xml);
        $origins = [];
        $custom = [];
        foreach ($xml->visibilityCondition as $child) $custom[(string) $child['name']] = true;
        foreach (['ifconfig' => [ConfigCondition::class, 'configPath', 'ifconfig'],
            'acl' => [AclCondition::class, 'acl', 'aclResource']] as $key => [$consumer, $argument, $attribute]) {
            if (isset($custom[$key])) continue;
            $kind = $key === 'acl' && isset($ids['condition-acl']) ? 'condition-acl' : 'condition-' . $attribute;
            $expected = ['name' => $consumer, 'arguments' => [$argument => (string) $xml[$attribute]]];
            if (isset($ids[$kind]) && ($result[$key] ?? null) === $expected) {
                $origins[$consumer] = ['id' => $ids[$kind], 'context' => $context,
                    'signature' => self::signature($expected['arguments'])];
            }
        }
        $this->conditionNodes[$xml] = ['signature' => self::signature($result), 'origins' => $origins];
    }

    private function beginVisibility($pool, array $params, string $class): void
    {
        if ($class === GeneratorPool::class) $this->visibility[] = ['schedule' => $params[0], 'queue' => [], 'current' => null];
    }

    private function endVisibility($pool, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class === GeneratorPool::class) array_pop($this->visibility);
    }

    private function visibilityElements($schedule, array $params, $elements, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->visibility);
        if ($error || $class !== ScheduledStructure::class || $index === null
            || $this->visibility[$index]['schedule'] !== $schedule) return;
        $caller = self::caller($schedule, 'getElements');
        if (($caller['class'] ?? null) !== GeneratorPool::class || ($caller['function'] ?? null) !== 'buildStructure') return;
        $state = $this->snapshot($schedule);
        $queue = [];
        foreach ($elements as $name => $element) {
            $queue[] = ['data' => self::signature($element[1]['attributes']['visibilityConditions'] ?? []),
                'origin' => $state[$name]['conditions'] ?? null];
        }
        $this->visibility[$index]['queue'] = $queue;
    }

    private function selectConditions($pool, array $params, $exists, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->visibility);
        if ($class !== GeneratorPool::class || $index === null) return;
        $entry = array_shift($this->visibility[$index]['queue']);
        $this->visibility[$index]['current'] = null;
        if (!$error && $exists && $entry && $entry['data'] !== null
            && $entry['data'] === self::signature($params[0]['attributes']['visibilityConditions'] ?? [])) {
            $this->visibility[$index]['current'] = $entry['origin'];
        }
    }

    private function beginConditions($condition, array $params, string $class): void
    {
        if ($class !== Condition::class) return;
        $index = array_key_last($this->visibility);
        $origin = $index === null ? null : $this->visibility[$index]['current'];
        $caller = self::caller($condition, 'isVisible');
        $valid = ($caller['class'] ?? null) === GeneratorPool::class && ($caller['function'] ?? null) === 'buildStructure'
            && $origin && $origin['signature'] !== null && $origin['signature'] === self::signature($params[0]);
        $this->conditions[] = $valid ? $origin['origins'] : [];
    }

    private function endConditions($condition, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class === Condition::class) array_pop($this->conditions);
    }

    private function conditionDecision($condition, array $params, $visible, ?\Throwable $error, string $class): void
    {
        if ($error || !is_bool($visible) || !in_array($class, [ConfigCondition::class, AclCondition::class], true)) return;
        $index = array_key_last($this->conditions);
        $origin = $index === null ? null : ($this->conditions[$index][$class] ?? null);
        $caller = self::caller($condition, 'isVisible');
        if (!$origin || ($caller['class'] ?? null) !== Condition::class || ($caller['function'] ?? null) !== 'isVisible'
            || $origin['signature'] !== self::signature($params[0])) return;
        self::record($origin, $visible ? 'layout-condition-allowed' : 'layout-condition-denied');
    }

    private function createUi($generator, array $params, $wrapper, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== UiGenerator::class || !$wrapper instanceof UiWrapper) return;
        [$structure, $name] = $params;
        $frame = $this->generating[array_key_last($this->generating)] ?? null;
        if (!$frame || $frame['structure'] !== $structure || $wrapper->getNameInLayout() !== $name) return;
        $origin = $frame['state'][$name]['ui'] ?? null;
        if ($origin) {
            self::record($origin, 'layout-ui-created');
            $this->components[$wrapper] = $origin;
        }
    }

    private function renderUi($wrapper, array $params, $result, ?\Throwable $error, string $class): void
    {
        if (!$error && $class === UiWrapper::class && isset($this->components[$wrapper])) {
            self::record($this->components[$wrapper], 'layout-ui-rendered');
        }
    }

    private function createContainer($generator, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== ContainerGenerator::class) return;
        $frame = $this->generating[array_key_last($this->generating)] ?? null;
        [$structure, $name] = $params;
        if (!$frame || $frame['structure'] !== $structure || !$structure->hasElement($name)) return;
        $entry = $frame['state'][$name] ?? [];
        if (isset($entry['container'])) self::record($entry['container'], 'layout-container-created');
        foreach ($entry['overridden'] ?? [] as $origin) self::record($origin, 'layout-container-attribute-overridden');
    }

    private function assignAttribute($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== DataStructure::class) return;
        [$name, $attribute] = $params;
        $state = $this->structures[$structure] ?? [];
        $previous = $state[$name][$attribute] ?? null;
        unset($state[$name][$attribute]);
        $frame = $this->generating[array_key_last($this->generating)] ?? null;
        $caller = self::caller($structure, 'setAttribute');
        if ($frame && $frame['structure'] === $structure
            && in_array([$caller['class'] ?? '', $caller['function'] ?? ''],
                [[ContainerGenerator::class, 'generateContainer'], [BlockGenerator::class, 'generateBlock']], true)) {
            $origin = $frame['state'][$name]['attributes'][$attribute] ?? null;
            if ($origin) $state[$name][$attribute] = $origin;
        } elseif ($previous) {
            self::record($previous, 'layout-container-attribute-replaced');
        }
        $this->structures[$structure] = $state;
    }

    private static function structure(Layout $layout)
    {
        static $property;
        $property ??= new \ReflectionProperty(Layout::class, 'structure');
        return $property->getValue($layout);
    }

    private function beginWrapper($layout, array $params, string $class): void
    {
        if ($class === Layout::class) $this->wrapping[] = ['structure' => self::structure($layout),
            'name' => $params[0], 'tagReads' => 0, 'origins' => []];
    }

    private function readAttribute($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->wrapping);
        if ($error || $class !== DataStructure::class || $index === null || !$result) return;
        [$name, $attribute] = $params;
        $frame = $this->wrapping[$index];
        if ($frame['structure'] !== $structure || $frame['name'] !== $name) return;
        $caller = self::caller($structure, 'getAttribute');
        if (($caller['class'] ?? null) !== Layout::class || ($caller['function'] ?? null) !== '_renderContainer') return;
        if ($attribute === 'htmlTag') $this->wrapping[$index]['tagReads']++;
        $origin = $this->structures[$structure][$name][$attribute] ?? null;
        if ($origin && in_array($attribute, ['htmlTag', 'htmlId', 'htmlClass'], true)) {
            $this->wrapping[$index]['origins'][$origin['id']] = $origin;
        }
    }

    private function endWrapper($layout, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Layout::class) return;
        $frame = array_pop($this->wrapping);
        if ($error || $frame['tagReads'] !== 2) return;
        foreach ($frame['origins'] as $origin) self::record($origin, 'layout-container-wrapper-rendered');
    }

    private function display($layout, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== Layout::class) return;
        $origin = $this->structures[self::structure($layout)][$params[0]]['display'] ?? null;
        if ($origin) self::record($origin, $result ? 'layout-display-allowed' : 'layout-display-denied');
    }

    private function beginCacheability($layout, array $params, string $class): void
    {
        if ($class !== Layout::class) return;
        static $cached, $enabled;
        $cached ??= new \ReflectionProperty(Layout::class, 'isCacheableCache');
        $enabled ??= new \ReflectionProperty(Layout::class, 'cacheable');
        $this->cacheability[] = ['fresh' => $cached->getValue($layout) === null && $enabled->getValue($layout),
            'candidate' => null, 'winner' => null, 'missing' => []];
    }

    private function cacheableBlock($element, array $params, $name, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->cacheability);
        if ($error || $class !== Layout\Element::class || $index === null || !$this->cacheability[$index]['fresh']) return;
        $caller = self::caller($element, 'getBlockName');
        if (($caller['class'] ?? null) !== Layout::class || ($caller['function'] ?? null) !== 'isCacheable') return;
        [$ids, $context] = ($this->origin)($element);
        $this->cacheability[$index]['candidate'] = ['name' => $name,
            'origin' => isset($ids['cacheability']) ? ['id' => $ids['cacheability'], 'context' => $context] : null];
    }

    private function cacheableTarget($structure, array $params, $exists, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->cacheability);
        if ($error || $class !== DataStructure::class || $index === null) return;
        $candidate = $this->cacheability[$index]['candidate'];
        if (!$candidate || !$candidate['origin'] || $candidate['name'] !== $params[0]) return;
        $caller = self::caller($structure, 'hasElement');
        if (($caller['class'] ?? null) !== Layout::class || ($caller['function'] ?? null) !== 'isCacheable') return;
        if ($exists) $this->cacheability[$index]['winner'] = $candidate['origin'];
        else $this->cacheability[$index]['missing'][] = $candidate['origin'];
        $this->cacheability[$index]['candidate'] = null;
    }

    private function endCacheability($layout, array $params, $cacheable, ?\Throwable $error, string $class): void
    {
        if ($class !== Layout::class) return;
        $frame = array_pop($this->cacheability);
        if ($error) return;
        foreach ($frame['missing'] as $origin) self::record($origin, 'layout-cacheability-target-missing');
        if ($cacheable === false && $frame['winner']) self::record($frame['winner'], 'layout-cacheability-denied');
    }

    private static function record(array $origin, string $effect): void
    {
        Recorder::layout($origin['id'], $effect, $origin['context']);
    }
}
