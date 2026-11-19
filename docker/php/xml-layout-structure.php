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
use Magento\Framework\View\Layout\Condition\ConditionFactory;
use Magento\Framework\View\Layout\Condition\VisibilityConditionInterface;
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
    private \WeakMap $conditionComposites;
    private array $conditionHooks = [];
    private array $errors = [];
    private array $limitations = [];
    private bool $healthy = false;

    public function __construct(
        private readonly \Closure $origin,
        private readonly \Closure $fingerprint,
        private readonly \Closure $matches
    )
    {
        $this->scheduled = new \WeakMap();
        $this->structures = new \WeakMap();
        $this->components = new \WeakMap();
        $this->conditionNodes = new \WeakMap();
        $this->conditionComposites = new \WeakMap();
    }

    public function finish(): array
    {
        if ($this->errors) throw new \RuntimeException(implode('; ', array_keys($this->errors)));
        return [$this->healthy, array_keys($this->limitations)];
    }

    public function hooks(): array
    {
        return [
            [ConditionReader::class, 'parseConditions', null, $this->parseConditions(...)],
            [GeneratorPool::class, 'buildStructure', $this->beginVisibility(...), $this->endVisibility(...)],
            [ScheduledStructure::class, 'getElements', null, $this->visibilityElements(...)],
            [GeneratorPool::class, 'visibilityConditionsExistsIn', null, $this->selectConditions(...)],
            [Condition::class, 'isVisible', $this->beginConditions(...), $this->endConditions(...)],
            [ConditionFactory::class, 'create', null, $this->conditionComposite(...)],
            [VisibilityConditionInterface::class, 'getName', null, $this->conditionName(...)],
            [VisibilityConditionInterface::class, 'isVisible', null, $this->conditionDecision(...)],
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
            [DataStructure::class, 'addToParentGroup', null, $this->uiGroup(...)],
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
        $trace = LayoutRuntimeHooks::trace(DEBUG_BACKTRACE_IGNORE_ARGS, 5);
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
        foreach (['htmlTag', 'htmlId', 'htmlClass', 'display', 'label'] as $attribute) {
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
        $trace = LayoutRuntimeHooks::trace(DEBUG_BACKTRACE_IGNORE_ARGS, 2);
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
        $attributes = $schedule->getStructureElementData($name, [])['attributes'] ?? [];
        if (isset($ids['ui-group']) && ($attributes['group'] ?? null) === (string) $xml['group']) {
            $state[$name]['uiGroup'] = ['id' => $ids['ui-group'], 'context' => $scope, 'value' => (string) $xml['group']];
        }
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
        foreach ($xml->visibilityCondition as $child) $custom[(string) $child['name']] = $child;
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
        $rules = [];
        foreach ($custom as $key => $node) {
            [$source, $ruleContext] = ($this->origin)($node);
            if (!isset($source['visibility']) || ($result[$key]['name'] ?? null) !== (string) $node['className']) continue;
            $arguments = $result[$key]['arguments'];
            $identity = ($this->fingerprint)($arguments);
            $rules[$key] = ['id' => $source['visibility'], 'nameId' => $source['visibility-name'] ?? null,
                'classId' => $source['visibility-class'] ?? null, 'context' => $ruleContext,
                'fingerprint' => $identity, 'arguments' => $identity === null ? [] : $this->conditionValues($node, $arguments)];
        }
        $this->conditionNodes[$xml] = ['fingerprint' => ($this->fingerprint)($result), 'origins' => $origins,
            'rules' => $rules, 'identity' => hash('sha256', serialize([array_column($origins, 'id'), array_column($rules, 'id'), $context]))];
    }

    private function conditionValues($xml, array $arguments): array
    {
        $nodes = [];
        foreach ($xml->arguments->argument as $node) $nodes[(string) $node['name']] = $node;
        $ids = [];
        foreach ($nodes as $name => $node) {
            if (array_key_exists($name, $arguments)) $ids = [...$ids, ...$this->conditionValue($node, $arguments[$name])];
        }
        return $ids;
    }

    private function conditionValue($xml, $value): array
    {
        [$source] = ($this->origin)($xml);
        $ids = isset($source['visibility-argument']) ? [$source['visibility-argument']] : [];
        if ((string) $xml->attributes('http://www.w3.org/2001/XMLSchema-instance')['type'] !== 'array' || !is_array($value)) return $ids;
        $nodes = [];
        foreach ($xml->item as $node) $nodes[(string) $node['name']] = $node;
        foreach ($nodes as $name => $node) {
            if (array_key_exists($name, $value)) $ids = [...$ids, ...$this->conditionValue($node, $value[$name])];
        }
        return $ids;
    }

    private function beginVisibility($pool, array $params, string $class): void
    {
        if ($class === GeneratorPool::class) $this->visibility[] = ['pool' => $pool, 'schedule' => $params[0], 'queue' => [], 'current' => null];
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
            $origin = $state[$name]['conditions'] ?? null;
            if ($origin) $origin['placement'] = $state[$name]['ui'] ?? null;
            $queue[] = ['data' => ($this->fingerprint)($element[1]['attributes']['visibilityConditions'] ?? []), 'origin' => $origin];
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
            && ($this->matches)($entry['data'], $params[0]['attributes']['visibilityConditions'] ?? [])) {
            $this->visibility[$index]['current'] = $entry['origin'];
        }
    }

    private static function compositeRules(Condition $condition): array
    {
        static $property;
        $property ??= new \ReflectionProperty(Condition::class, 'conditions');
        return $property->getValue($condition);
    }

    private function conditionComposite($factory, array $params, $composite, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->visibility);
        $origin = $index === null ? null : $this->visibility[$index]['current'];
        $caller = self::caller($factory, 'create');
        if ($error || $class !== ConditionFactory::class || !$origin || $origin['fingerprint'] === null
            || !($this->matches)($origin['fingerprint'], $params[0])
            || ($caller['class'] ?? null) !== GeneratorPool::class || ($caller['function'] ?? null) !== 'buildStructure') return;
        if ($composite instanceof Condition) $this->conditionComposites[$composite] = ['unsupported' => true];
        if (get_class($factory) !== ConditionFactory::class || !($composite instanceof Condition) || get_class($composite) !== Condition::class) return;
        $objects = self::compositeRules($composite);
        if (count($objects) !== count($params[0])) return;
        $ordered = [];
        foreach (array_keys($params[0]) as $position => $key) {
            $object = $objects[$position] ?? null;
            $row = $origin['rules'][$key] ?? null;
            if (!is_object($object)) continue;
            $ready = $this->ruleHooks($object);
            $ordered[] = ['object' => $object, 'owner' => $row, 'key' => $key, 'ready' => $ready];
            if (!$row) continue;
            if ($row['classId']) $this->record(['id' => $row['classId'], 'context' => $row['context']], 'layout-condition-class-selected');
            if (!$ready) $this->unconfirmedCondition($row);
        }
        $this->conditionComposites[$composite] = ['identity' => $origin['identity'], 'objects' => $objects, 'ordered' => $ordered];
    }

    private function ruleHooks(object $rule): bool
    {
        if ($rule instanceof VisibilityConditionInterface) return true;
        foreach (['getName', 'isVisible'] as $method) {
            $target = method_exists($rule, $method) && (new \ReflectionMethod($rule, $method))->isPublic() ? $method : '__call';
            if (!method_exists($rule, $target) || !(new \ReflectionMethod($rule, $target))->isPublic()) return false;
            $class = (new \ReflectionMethod($rule, $target))->getDeclaringClass()->getName();
            if (!isset($this->conditionHooks[$class]) && count($this->conditionHooks) >= 1024) {
                $this->limitations['layout-condition-hook-limit'] = true;
                return false;
            }
            $this->conditionHooks[$class] ??= [];
            if (isset($this->conditionHooks[$class][$target])) continue;
            if (!LayoutRuntimeHooks::register($class, $target, null, $this->conditionDynamic(...))) {
                $this->errors['Cannot register native visibility rule hook'] = true;
                return false;
            }
            $this->conditionHooks[$class][$target] = true;
        }
        return true;
    }

    private function unconfirmedCondition(array $row): void
    {
        foreach (array_filter([$row['id'], $row['nameId'], $row['classId'], ...$row['arguments']]) as $id) {
            $this->record(['id' => $id, 'context' => $row['context']], 'layout-condition-unconfirmed');
        }
    }

    private function beginConditions($condition, array $params, string $class): void
    {
        if ($class !== Condition::class) return;
        $index = array_key_last($this->visibility);
        $origin = $index === null ? null : $this->visibility[$index]['current'];
        $caller = self::caller($condition, 'isVisible');
        $valid = ($caller['class'] ?? null) === GeneratorPool::class && ($caller['function'] ?? null) === 'buildStructure'
            && $origin && $origin['fingerprint'] !== null && ($this->matches)($origin['fingerprint'], $params[0]);
        $binding = $this->conditionComposites[$condition] ?? null;
        if ($valid && $origin['rules'] && $binding === null && get_class($condition) === Condition::class) {
            static $factoryProperty;
            $factoryProperty ??= new \ReflectionProperty(GeneratorPool::class, 'conditionFactory');
            if (get_class($factoryProperty->getValue($this->visibility[$index]['pool'])) === ConditionFactory::class) {
                $this->errors['Missing native visibility factory hook evidence'] = true;
            }
        }
        $bound = $valid && $binding && empty($binding['unsupported']) && $binding['identity'] === $origin['identity']
            && $binding['objects'] === self::compositeRules($condition);
        if ($valid && !$bound) foreach ($origin['rules'] as $row) $this->unconfirmedCondition($row);
        $this->conditions[] = ['origins' => $valid ? $origin['origins'] : [],
            'ordered' => $bound ? $binding['ordered'] : [], 'values' => $valid ? $origin['rules'] : [],
            'next' => 0, 'current' => null, 'name' => null, 'keys' => [], 'decisions' => [],
            'placement' => $valid ? ($origin['placement'] ?? null) : null];
    }

    private function endConditions($condition, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Condition::class) return;
        $frame = array_pop($this->conditions);
        if (!$error) {
            foreach ($frame['ordered'] as $position => $entry) {
                if (!$entry['ready']) continue;
                if ($result === true && !isset($frame['keys'][$position])) $this->errors['Missing native visibility key hook evidence'] = true;
                if (isset($frame['keys'][$position]) && !isset($frame['decisions'][$position])) {
                    $this->errors['Missing native visibility decision hook evidence'] = true;
                }
            }
            if ($result === false && (!$frame['decisions'] || end($frame['decisions']) !== false)) {
                $remaining = array_slice($frame['ordered'], $frame['next']);
                if (!array_filter($remaining, static fn($entry) => !$entry['ready'])) {
                    $this->errors['Missing native visibility key hook evidence'] = true;
                }
            }
        }
        if (!$error && $result === false && $frame['placement']) $this->record($frame['placement'], 'layout-ui-denied');
    }

    private function conditionName($condition, array $params, $name, ?\Throwable $error, string $class): void
    {
        $caller = is_object($condition) ? self::caller($condition, 'getName') : (LayoutRuntimeHooks::trace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? []);
        $this->recordConditionName($condition, $name, $error, $class, $caller);
    }

    private static function ruleTarget(object $expected, $subject, string $class, string $method): bool
    {
        if (is_object($subject)) return $subject === $expected;
        $reflection = new \ReflectionMethod($expected, $method);
        return is_string($subject) && is_a($expected, $subject) && $reflection->isStatic()
            && $reflection->getDeclaringClass()->getName() === $class;
    }

    private function recordConditionName($condition, $name, ?\Throwable $error, string $class, array $caller): void
    {
        $index = array_key_last($this->conditions);
        if ($index === null || ($caller['class'] ?? null) !== Condition::class || ($caller['function'] ?? null) !== 'isVisible') return;
        $frame = &$this->conditions[$index];
        while (isset($frame['ordered'][$frame['next']]) && !$frame['ordered'][$frame['next']]['ready']) $frame['next']++;
        $position = $frame['next'];
        $entry = $frame['ordered'][$position] ?? null;
        if (!$entry) return;
        if (!self::ruleTarget($entry['object'], $condition, $class, 'getName')) {
            $this->errors['Missing native visibility key hook evidence'] = true;
            return;
        }
        $frame['next']++;
        $frame['current'] = $position;
        $frame['keys'][$position] = true;
        $frame['name'] = null;
        if ($error || (!is_string($name) && !is_int($name))) {
            if ($entry['owner']) $this->unconfirmedCondition($entry['owner']);
            return;
        }
        $frame['name'] = ['values' => $frame['values'][$name] ?? null, 'ownName' => $name === $entry['key']];
    }

    private function conditionDecision($condition, array $params, $visible, ?\Throwable $error, string $class): void
    {
        $caller = is_object($condition) ? self::caller($condition, 'isVisible') : (LayoutRuntimeHooks::trace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? []);
        $this->recordConditionDecision($condition, $params, $visible, $error, $class, $caller);
    }

    private function conditionDynamic($condition, array $params, $result, ?\Throwable $error, string $class, string $method): void
    {
        if ($condition instanceof VisibilityConditionInterface) return;
        $caller = is_object($condition) ? self::caller($condition, $method) : (LayoutRuntimeHooks::trace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? []);
        $method = strtolower($method);
        if ($method === '__call') {
            $method = strtolower($params[0] ?? '');
            $params = $params[1] ?? [];
        }
        if ($method === 'getname') $this->recordConditionName($condition, $result, $error, $class, $caller);
        if ($method === 'isvisible' && is_array($params)) $this->recordConditionDecision($condition, $params, $result, $error, $class, $caller);
    }

    private function recordConditionDecision($condition, array $params, $visible, ?\Throwable $error, string $class, array $caller): void
    {
        $index = array_key_last($this->conditions);
        if ($index === null || ($caller['class'] ?? null) !== Condition::class || ($caller['function'] ?? null) !== 'isVisible') return;
        $frame = &$this->conditions[$index];
        $position = $frame['current'];
        $entry = $position === null ? null : ($frame['ordered'][$position] ?? null);
        if (!$entry || !self::ruleTarget($entry['object'], $condition, $class, 'isVisible')) {
            if ($frame['ordered']) $this->errors['Missing native visibility key hook evidence'] = true;
            return;
        }
        $frame['decisions'][$position] = (bool) $visible;
        $origin = $frame['origins'][$class] ?? null;
        if (!$error && is_bool($visible) && $origin && $origin['signature'] === self::signature($params[0])) {
            $this->record($origin, $visible ? 'layout-condition-allowed' : 'layout-condition-denied');
        }
        $owner = $entry['owner'];
        $binding = $frame['name'];
        if (!$owner || !$binding) return;
        $values = $binding['values'];
        if (!$binding['ownName']) {
            if ($owner['nameId']) $this->record(['id' => $owner['nameId'], 'context' => $owner['context']], 'layout-condition-name-unused');
            foreach ($owner['arguments'] as $id) $this->record(['id' => $id, 'context' => $owner['context']], 'layout-condition-argument-unconsumed');
        }
        if ($values && $values['nameId']) $this->record(['id' => $values['nameId'], 'context' => $values['context']], 'layout-condition-name-applied');
        $origin = ['id' => $owner['id'], 'context' => $owner['context']];
        if ($error) { $this->record($origin, 'layout-condition-failed'); return; }
        $this->record($origin, $visible ? 'layout-condition-allowed' : 'layout-condition-denied');
        if ($values && $values['fingerprint'] !== null && ($this->matches)($values['fingerprint'], $params[0])) {
            foreach ($values['arguments'] as $id) $this->record(['id' => $id, 'context' => $values['context']], 'layout-condition-argument-applied');
        }
    }

    private function uiGroup($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        $frame = $this->generating[array_key_last($this->generating)] ?? null;
        if ($error || $class !== DataStructure::class || !$frame || $frame['structure'] !== $structure) return;
        $caller = self::caller($structure, 'addToParentGroup');
        if (($caller['class'] ?? null) !== UiGenerator::class || ($caller['function'] ?? null) !== 'generateComponent') return;
        $origin = $frame['state'][$params[0]]['uiGroup'] ?? null;
        $parent = $structure->getParentId($params[0]);
        if ($origin && $origin['value'] === $params[1] && $parent
            && in_array($params[0], $structure->getGroupChildNames($parent, $params[1]), true)) $this->record($origin, 'layout-ui-group-applied');
    }

    private function createUi($generator, array $params, $wrapper, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== UiGenerator::class || !$wrapper instanceof UiWrapper) return;
        [$structure, $name] = $params;
        $frame = $this->generating[array_key_last($this->generating)] ?? null;
        if (!$frame || $frame['structure'] !== $structure || $wrapper->getNameInLayout() !== $name) return;
        $origin = $frame['state'][$name]['ui'] ?? null;
        if ($origin) {
            $this->record($origin, 'layout-ui-created');
            $this->components[$wrapper] = $origin;
        }
    }

    private function renderUi($wrapper, array $params, $result, ?\Throwable $error, string $class): void
    {
        if (!$error && $class === UiWrapper::class && isset($this->components[$wrapper])) {
            $this->record($this->components[$wrapper], 'layout-ui-rendered');
        }
    }

    private function createContainer($generator, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== ContainerGenerator::class) return;
        $frame = $this->generating[array_key_last($this->generating)] ?? null;
        [$structure, $name] = $params;
        if (!$frame || $frame['structure'] !== $structure || !$structure->hasElement($name)) return;
        $entry = $frame['state'][$name] ?? [];
        if (isset($entry['container'])) $this->record($entry['container'], 'layout-container-created');
        foreach ($entry['overridden'] ?? [] as $origin) $this->record($origin, 'layout-container-attribute-overridden');
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
            if ($origin) {
                $state[$name][$attribute] = $origin;
                if ($attribute === 'label') $this->record($origin, 'layout-container-label-applied');
            }
        } elseif ($previous) {
            $this->record($previous, 'layout-container-attribute-replaced');
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
            'name' => $params[0], 'tagReads' => 0, 'origins' => [], 'zeroClasses' => []];
    }

    private function readAttribute($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        if (!$error && $class === DataStructure::class && ($params[1] ?? null) === 'label') {
            $caller = self::caller($structure, 'getAttribute');
            $origin = $this->structures[$structure][$params[0]]['label'] ?? null;
            if ($origin && ($caller['class'] ?? null) === Layout::class && ($caller['function'] ?? null) === 'getElementProperty') {
                $this->record($origin, 'layout-container-label-read');
            }
        }
        $index = array_key_last($this->wrapping);
        if ($error || $class !== DataStructure::class || $index === null || (!$result && !($result === '0' && ($params[1] ?? null) === 'htmlClass'))) return;
        [$name, $attribute] = $params;
        $frame = $this->wrapping[$index];
        if ($frame['structure'] !== $structure || $frame['name'] !== $name) return;
        $caller = self::caller($structure, 'getAttribute');
        if (($caller['class'] ?? null) !== Layout::class || ($caller['function'] ?? null) !== '_renderContainer') return;
        if ($attribute === 'htmlTag') $this->wrapping[$index]['tagReads']++;
        $origin = $this->structures[$structure][$name][$attribute] ?? null;
        if ($origin && $attribute === 'htmlClass' && $result === '0') {
            $this->wrapping[$index]['zeroClasses'][$origin['id']] = $origin;
            return;
        }
        if ($origin && in_array($attribute, ['htmlTag', 'htmlId', 'htmlClass'], true)) {
            $this->wrapping[$index]['origins'][$origin['id']] = $origin;
        }
    }

    private function endWrapper($layout, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Layout::class) return;
        $frame = array_pop($this->wrapping);
        if ($error || $frame['tagReads'] !== 2) return;
        foreach ($frame['origins'] as $origin) $this->record($origin, 'layout-container-wrapper-rendered');
        foreach ($frame['zeroClasses'] as $origin) $this->record($origin, 'layout-container-wrapper-zero-class-emitted');
    }

    private function display($layout, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== Layout::class) return;
        $origin = $this->structures[self::structure($layout)][$params[0]]['display'] ?? null;
        if ($origin) $this->record($origin, $result ? 'layout-display-allowed' : 'layout-display-denied');
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
        foreach ($frame['missing'] as $origin) $this->record($origin, 'layout-cacheability-target-missing');
        if ($cacheable === false && $frame['winner']) $this->record($frame['winner'], 'layout-cacheability-denied');
    }

    private function record(array $origin, string $effect): void
    {
        if (in_array($effect, ['layout-condition-allowed', 'layout-condition-denied', 'layout-condition-name-applied',
            'layout-condition-class-selected', 'layout-condition-argument-applied', 'layout-ui-group-applied',
            'layout-ui-created', 'layout-ui-rendered', 'layout-container-created', 'layout-container-label-applied',
            'layout-container-label-read', 'layout-container-wrapper-rendered', 'layout-container-wrapper-zero-class-emitted', 'layout-display-allowed',
            'layout-display-denied', 'layout-cacheability-denied'], true)) $this->healthy = true;
        Recorder::layout($origin['id'], $effect, $origin['context']);
    }
}
