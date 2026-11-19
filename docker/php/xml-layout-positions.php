<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\Data\Structure;
use Magento\Framework\View\Layout\Data\Structure as LayoutStructure;
use Magento\Framework\View\Layout\GeneratorPool;
use Magento\Framework\View\Layout\ScheduledStructure;
use Magento\Framework\View\Layout\ScheduledStructure\Helper;

final class LayoutPositionCoverage
{
    private \WeakMap $scheduled;
    private \WeakMap $elements;
    private array $creating = [];
    private array $ordering = [];
    private array $defaultedNames = [];

    public function __construct(private readonly \Closure $origin, array $sources = [])
    {
        $this->scheduled = new \WeakMap();
        $this->elements = new \WeakMap();
        foreach ($sources as $source) {
            foreach ($source['targets'] as $target) {
                if (!in_array($target['element'] ?? null, ['', '0'], true) || !isset($target['ids']['position-name'])) continue;
                $id = $target['ids']['position-name'];
                if (!isset($this->defaultedNames[$id]) && count($this->defaultedNames) >= 32768) {
                    throw new \RuntimeException('Layout defaulted name inventory exceeded 32768 operands');
                }
                $this->defaultedNames[$id] = true;
            }
        }
    }

    public function hooks(): array
    {
        return [
            [Helper::class, 'scheduleStructure', null, $this->schedule(...)],
            [ScheduledStructure::class, 'setStructureElement', null, $this->replaceSchedule(...)],
            [Helper::class, 'scheduleElement', $this->beginElement(...), $this->completeElement(...)],
            [Structure::class, 'createElement', null, $this->created(...)],
            [Structure::class, 'importElements', null, $this->imported(...)],
            [Structure::class, 'setAsChild', null, $this->reparented(...)],
            [Structure::class, 'renameElement', null, $this->renamed(...)],
            [Structure::class, 'reorderChild', null, $this->reorderedDirectly(...)],
            [Structure::class, 'reorderToSibling', null, $this->reorderedDirectly(...)],
            [LayoutStructure::class, 'reorderChildElement', $this->beginOrder(...), $this->completeOrder(...)],
            [GeneratorPool::class, 'buildStructure', null, $this->completeStructure(...)],
        ];
    }

    public function snapshot(ScheduledStructure $schedule): array
    {
        return $this->scheduled[$schedule] ?? [];
    }

    public function restore(ScheduledStructure $schedule, array $entries): void
    {
        $this->scheduled[$schedule] = $entries;
    }

    public function reset(ScheduledStructure $schedule): void
    {
        unset($this->scheduled[$schedule]);
    }

    private static function caller(object $subject, string $method): array
    {
        $trace = LayoutRuntimeHooks::trace(DEBUG_BACKTRACE_IGNORE_ARGS, 5);
        $caller = $trace[3] ?? [];
        $wrapper = get_class($subject);
        if (str_ends_with($wrapper, '\\Interceptor') && ($caller['class'] ?? null) === $wrapper
            && ($caller['function'] ?? null) === $method) return $trace[4] ?? [];
        return $caller;
    }

    private function schedule($helper, array $params, $name, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== Helper::class) return;
        [$schedule, $xml] = $params;
        [$ids, $context] = ($this->origin)($xml);
        $ids = array_intersect_key($ids, array_flip(['position-name', 'position-as', 'position-before', 'position-after']));
        $entries = $this->snapshot($schedule);
        unset($entries[$name]);
        if ($ids) {
            $entries[$name] = ['ids' => $ids, 'context' => $context, 'row' => $schedule->getStructureElement($name)];
            if (isset($ids['position-before'], $xml['after'])) self::record($ids['position-before'], 'layout-position-ignored', $context);
        }
        $this->restore($schedule, $entries);
    }

    private function replaceSchedule($schedule, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== ScheduledStructure::class) return;
        $caller = self::caller($schedule, 'setStructureElement');
        if (($caller['class'] ?? null) === Helper::class && ($caller['function'] ?? null) === 'scheduleStructure') return;
        $entries = $this->snapshot($schedule);
        unset($entries[$params[0]]);
        $this->restore($schedule, $entries);
    }

    private function beginElement($helper, array $params, string $class): void
    {
        if ($class !== Helper::class) return;
        [$schedule, $structure, $name] = $params;
        $origin = $this->snapshot($schedule)[$name] ?? null;
        if ($origin && $origin['row'] !== $schedule->getStructureElement($name)) $origin = null;
        $this->creating[] = ['structure' => $structure, 'name' => $name, 'origin' => $origin, 'created' => false];
    }

    private function created($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== Structure::class) return;
        $entries = $this->elements[$structure] ?? [];
        unset($entries[$params[0]]);
        $this->elements[$structure] = $entries;
        $index = array_key_last($this->creating);
        $caller = self::caller($structure, 'createElement');
        if ($index !== null && $this->creating[$index]['structure'] === $structure
            && $this->creating[$index]['name'] === $params[0]
            && ($caller['class'] ?? null) === Helper::class && ($caller['function'] ?? null) === '_createStructuralElement') {
            $this->creating[$index]['created'] = true;
        }
    }

    private function imported($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        if (!$error && $class === Structure::class) unset($this->elements[$structure]);
    }

    private function completeElement($helper, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Helper::class) return;
        $frame = array_pop($this->creating);
        if ($error || !$frame['created'] || !$frame['origin']) return;
        $origin = $frame['origin'];
        [, $alias, $parent] = $origin['row'];
        $entries = $this->elements[$frame['structure']] ?? [];
        $entry = ['source' => $origin, 'name' => $origin['ids']['position-name'] ?? null];
        if ($alias !== '' && $frame['structure']->getParentId($frame['name']) === $parent
            && $frame['structure']->getChildAlias($parent, $frame['name']) === $alias) {
            $entry['alias'] = $origin['ids']['position-as'] ?? null;
        }
        $entries[$frame['name']] = $entry;
        $this->elements[$frame['structure']] = $entries;
    }

    private function revoke($structure, string|int $name, array $keys): void
    {
        $entries = $this->elements[$structure] ?? [];
        if (!isset($entries[$name])) return;
        foreach ($keys as $key) {
            if (!empty($entries[$name][$key])) $entries[$name]['replaced'][$entries[$name][$key]] = true;
            unset($entries[$name][$key]);
        }
        $this->elements[$structure] = $entries;
    }

    private function reparented($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        if (!$error && $class === Structure::class) $this->revoke($structure, $params[0], ['alias', 'order']);
    }

    private function renamed($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        if (!$error && $class === Structure::class) $this->revoke($structure, $params[0], ['name', 'alias', 'order']);
    }

    private function reorderedDirectly($structure, array $params, $result, ?\Throwable $error, string $class, string $function): void
    {
        if ($error || $class !== Structure::class) return;
        $caller = self::caller($structure, $function);
        if (($caller['class'] ?? null) === LayoutStructure::class && ($caller['function'] ?? null) === 'reorderChildElement') return;
        $this->revoke($structure, $params[1], ['order']);
    }

    private function beginOrder($structure, array $params, string $class): void
    {
        if ($class !== LayoutStructure::class) return;
        $entry = $this->elements[$structure][$params[1]] ?? null;
        $caller = self::caller($structure, 'reorderChildElement');
        $source = ($caller['class'] ?? null) === GeneratorPool::class && ($caller['function'] ?? null) === 'reorderElements'
            ? ($entry['source'] ?? null) : null;
        if ($source && array_slice($source['row'], Helper::SCHEDULED_STRUCTURE_INDEX_PARENT_NAME) !== [$params[0], $params[2], $params[3] ?? true]) $source = null;
        $this->ordering[] = ['source' => $source, 'before' => array_keys($structure->getChildren($params[0]))];
    }

    private function completeOrder($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== LayoutStructure::class) return;
        $frame = array_pop($this->ordering);
        if ($error) return;
        $this->revoke($structure, $params[1], ['order']);
        $source = $frame['source'];
        if (!$source) return;
        $id = $source['ids'][$source['row'][Helper::SCHEDULED_STRUCTURE_INDEX_IS_AFTER] ? 'position-after' : 'position-before'] ?? null;
        if (!$id) return;
        $after = array_keys($structure->getChildren($params[0]));
        if ($after === $frame['before']) {
            self::record($id, 'layout-position-order-unchanged', $source['context']);
            return;
        }
        $entries = $this->elements[$structure];
        $entries[$params[1]]['order'] = $id;
        $this->elements[$structure] = $entries;
    }

    private function completeStructure($pool, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== GeneratorPool::class) return;
        $structure = $params[1];
        foreach ($this->elements[$structure] ?? [] as $name => $entry) {
            $source = $entry['source'];
            [, $alias, $parent] = $source['row'];
            if (!$structure->hasElement($name)) continue;
            if (!empty($entry['name'])) self::record($entry['name'], isset($this->defaultedNames[$entry['name']])
                ? 'layout-position-name-defaulted' : 'layout-position-name-applied', $source['context']);
            foreach (array_keys($entry['replaced'] ?? []) as $id) self::record($id, 'layout-position-replaced', $source['context']);
            if (!empty($entry['alias']) && $structure->getParentId($name) === $parent
                && $structure->getChildAlias($parent, $name) === $alias) {
                self::record($entry['alias'], 'layout-position-alias-applied', $source['context']);
            }
            if (!empty($entry['order']) && self::hasPosition($structure, $name, $source['row'])) {
                self::record($entry['order'], 'layout-position-order-applied', $source['context']);
            }
        }
    }

    private static function hasPosition($structure, string|int $name, array $row): bool
    {
        [, , $parent, $sibling, $after] = $row;
        if ($structure->getParentId($name) !== $parent) return false;
        $children = array_keys($structure->getChildren($parent));
        $position = array_search($name, $children, true);
        if ($sibling === '-') return $position === ($after ? count($children) - 1 : 0);
        $child = $structure->getChildId($parent, $sibling);
        $offset = array_search($child === false ? $sibling : $child, $children, true);
        return $position !== false && $offset !== false && ($after ? $position > $offset : $position < $offset);
    }

    private static function record(string $id, string $effect, array $context): void
    {
        Recorder::layout($id, $effect, $context);
    }
}
