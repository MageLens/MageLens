<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\Data\Structure;
use Magento\Framework\Simplexml\Element;
use Magento\Framework\View\Layout\GeneratorPool;
use Magento\Framework\View\Layout\Reader\Block;
use Magento\Framework\View\Layout\Reader\Container;
use Magento\Framework\View\Layout\Reader\Context;
use Magento\Framework\View\Layout\ScheduledStructure;
use Magento\Framework\View\Layout\ScheduledStructure\Helper;

/** Reference operands inherit only proven effects on their own named target. */
final class LayoutReferenceCoverage
{
    private const EFFECTS = [
        'layout-template-selected', 'layout-template-executed', 'layout-template-overridden', 'layout-template-replaced',
        'layout-template-origin-unconfirmed', 'layout-template-field-access-unconfirmed', 'layout-template-cache-unconfirmed', 'layout-template-failed',
        'layout-template-resolver-storage-unconfirmed', 'layout-template-context-storage-unconfirmed',
        'layout-template-engine-pool-storage-unconfirmed', 'layout-template-validation-rejected',
        'layout-argument-applied', 'layout-argument-read', 'layout-argument-replaced',
        'layout-argument-application-unconfirmed', 'layout-argument-storage-unconfirmed', 'layout-argument-field-access-unconfirmed',
        'layout-action-executed', 'layout-action-ambiguous',
        'layout-container-wrapper-rendered', 'layout-container-label-applied', 'layout-container-label-read',
        'layout-container-wrapper-zero-class-emitted', 'layout-template-empty-ignored',
        'layout-block-group-empty-ignored', 'layout-block-ttl-empty-ignored', 'layout-display-empty-ignored',
        'layout-removal-empty-ignored',
        'layout-container-attribute-overridden', 'layout-container-attribute-replaced',
        'layout-block-class-applied', 'layout-block-group-applied', 'layout-block-ttl-applied',
        'layout-block-class-origin-unconfirmed', 'layout-block-class-storage-unconfirmed', 'layout-block-class-defaulted', 'layout-block-ttl-origin-unconfirmed',
        'layout-block-attribute-overridden', 'layout-display-allowed', 'layout-display-denied',
        'layout-removal-applied', 'layout-removal-restored', 'layout-removal-canceled', 'layout-removal-missing',
    ];
    private array $definitions = [];
    private array $owners = [];
    private array $seen = [];
    private \WeakMap $reads;
    private \WeakMap $removed;
    private \WeakMap $children;
    private \WeakMap $attachments;
    private array $building = [];
    private array $removing = [];
    private array $processing = [];
    private int $processOverflow = 0;
    private array $scheduling = [];
    private array $placing = [];
    private int $scheduleOverflow = 0;
    private int $placingOverflow = 0;
    private int $overflow = 0;
    private int $removalOverflow = 0;
    private array $errors = [];

    public function __construct(array $sources, private readonly \Closure $origin)
    {
        $this->reads = new \WeakMap();
        $this->removed = new \WeakMap();
        $this->children = new \WeakMap();
        $this->attachments = new \WeakMap();
        foreach ($sources as $source) {
            foreach ($source['targets'] as $target) {
                if (isset($target['reference'])) $this->definitions[$target['reference']['id']] = $target['reference'];
                if (!isset($target['referenceOwner'])) continue;
                foreach ($target['ids'] as $kind => $id) {
                    if (!in_array($kind, ['reference', 'reference-name', 'action-method', 'action-argument'], true)) {
                        $this->owners[$id] = $target['referenceOwner'];
                    }
                }
            }
        }
        if (count($this->definitions) > 8192 || count($this->owners) > 32768) {
            throw new \RuntimeException('Layout reference inventory exceeded 8192 declarations or 32768 effect origins');
        }
    }

    public function hooks(): array
    {
        if (!$this->definitions) return [];
        return [
            [Block::class, 'scheduleReference', null, $this->read(...)],
            [Container::class, 'containerReference', null, $this->read(...)],
            [GeneratorPool::class, 'buildStructure', $this->begin(...), $this->complete(...)],
            [GeneratorPool::class, 'process', $this->beginProcess(...), $this->completeProcess(...)],
            [GeneratorPool::class, 'removeElement', $this->beginRemoval(...), $this->completeRemoval(...)],
            [Helper::class, 'scheduleStructure', $this->beginChild(...), $this->child(...)],
            [Helper::class, 'scheduleElement', $this->beginPlacement(...), $this->completePlacement(...)],
            [ScheduledStructure::class, 'setStructureElement', null, $this->replacedChild(...)],
            [Structure::class, 'setAsChild', null, $this->attached(...)],
            [Structure::class, 'hasElement', null, $this->parentLookup(...)],
        ];
    }

    public function snapshot(object $schedule): array
    {
        $reads = $this->reads[$schedule] ?? [];
        $children = $this->children[$schedule] ?? [];
        return $reads || $children ? ['reads' => $reads, 'children' => $children] : [];
    }

    public function restore(object $schedule, array $entries): void
    {
        if ($entries) {
            $this->reads[$schedule] = $entries['reads'];
            $this->children[$schedule] = $entries['children'];
        }
    }

    public function reset(object $schedule): void
    {
        unset($this->reads[$schedule], $this->removed[$schedule], $this->children[$schedule]);
    }

    private static function row(object $schedule, string|int $name): ?array
    {
        foreach (['getStructureElement', 'hasStructureElement'] as $method) {
            if ((new \ReflectionMethod($schedule, $method))->getDeclaringClass()->getName() !== ScheduledStructure::class) return null;
        }
        $field = LayoutXmlOwnership::unhookedProperty($schedule, 'scheduledStructure');
        return $field ? ($field->getRawValue($schedule)[$name] ?? null) : null;
    }

    private function child($helper, array $params, $name, ?\Throwable $error, string $class): void
    {
        if ($class !== Helper::class) return;
        if ($this->scheduleOverflow) { $this->scheduleOverflow--; return; }
        $frame = array_pop($this->scheduling);
        if (!$frame || $frame['schedule'] !== $params[0]) {
            $this->errors['Unbalanced native layout reference child schedule hook evidence'] = true;
            return;
        }
        if ($error) return;
        [$schedule, $xml, $parent] = $params;
        $entries = $this->children[$schedule] ?? [];
        unset($entries[$name]);
        [$ids, $context] = ($this->origin)($parent);
        $id = $ids['reference'] ?? null;
        if ($id && isset($this->definitions[$id]) && $context !== null) {
            if (!$frame['written'] && (new \ReflectionMethod($schedule, 'setStructureElement'))->getDeclaringClass()->getName() === ScheduledStructure::class) {
                $this->errors['Missing native layout reference child schedule writer hook evidence'] = true;
            }
            if (count($entries) >= 8192) {
                $this->errors['Layout reference child origins exceeded 8192 elements'] = true;
                return;
            }
            $row = self::row($schedule, $name);
            if ($row && (new \ReflectionMethod($helper, 'scheduleStructure'))->getDeclaringClass()->getName() === Helper::class
                && ($row[2] ?? null) === $this->definitions[$id]['element']) {
                $entries[$name] = ['id' => $id, 'row' => $row, 'context' => $context];
            } else $this->decision($id, 'layout-reference-origin-unconfirmed', $context);
        }
        $this->children[$schedule] = $entries;
    }

    private function replacedChild($schedule, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== ScheduledStructure::class) return;
        $caller = LayoutXmlOwnership::caller($schedule, 'setStructureElement');
        if (($caller['class'] ?? null) === Helper::class && ($caller['function'] ?? null) === 'scheduleStructure') {
            $index = array_key_last($this->scheduling);
            if ($index !== null && !$this->scheduleOverflow && $this->scheduling[$index]['schedule'] === $schedule) {
                $this->scheduling[$index]['written'] = true;
            } elseif (!$this->scheduleOverflow) $this->errors['Missing native layout reference child schedule hook evidence'] = true;
            return;
        }
        $entries = $this->children[$schedule] ?? [];
        if (isset($entries[$params[0]])) {
            $this->decision($entries[$params[0]]['id'], 'layout-reference-child-replaced', $entries[$params[0]]['context']);
        }
        unset($entries[$params[0]]);
        $this->children[$schedule] = $entries;
    }

    private function attached($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Structure::class) return;
        $entries = $this->attachments[$structure] ?? [];
        $previous = $entries[$params[0]] ?? null;
        unset($entries[$params[0]]);
        $this->attachments[$structure] = $entries;
        $frame = $this->building[array_key_last($this->building)] ?? null;
        $caller = LayoutXmlOwnership::caller($structure, 'setAsChild');
        $source = $frame && $frame['structure'] === $structure ? ($this->children[$frame['schedule']][$params[0]] ?? null) : null;
        if ($source && ($caller['class'] ?? null) === Helper::class && ($caller['function'] ?? null) === 'scheduleElement') {
            $index = array_key_last($this->placing);
            if ($index === null || $this->placingOverflow || $this->placing[$index]['structure'] !== $structure) {
                $this->errors['Missing native layout reference child helper hook evidence'] = true;
            } else $this->placing[$index]['setter'] = true;
        }
        if (!$error && $source && ($caller['class'] ?? null) === Helper::class
            && ($caller['function'] ?? null) === 'scheduleElement'
            && (new \ReflectionMethod($structure, 'setAsChild'))->getDeclaringClass()->getName() === Structure::class
            && self::row($frame['schedule'], $params[0]) === $source['row']
            && $params[1] === $this->definitions[$source['id']]['element']) {
            $entries[$params[0]] = $source;
            $this->attachments[$structure] = $entries;
        } elseif ($previous) {
            $this->decision($previous['id'], 'layout-reference-child-replaced', $previous['context']);
        }
    }

    private function beginChild($helper, array $params, string $class): void
    {
        if ($class !== Helper::class) return;
        if ($this->scheduleOverflow || count($this->scheduling) >= 256) {
            $this->scheduleOverflow++;
            $this->errors['Layout reference child scheduling nesting exceeded 256 calls'] = true;
            return;
        }
        $this->scheduling[] = ['schedule' => $params[0], 'written' => false];
    }

    private function beginPlacement($helper, array $params, string $class): void
    {
        if ($class !== Helper::class) return;
        if ($this->placingOverflow || count($this->placing) >= 256) {
            $this->placingOverflow++;
            $this->errors['Layout reference child placement nesting exceeded 256 calls'] = true;
            return;
        }
        $this->placing[] = ['structure' => $params[1], 'source' => $this->children[$params[0]][$params[2]] ?? null,
            'lookup' => false, 'expected' => false, 'setter' => false];
    }

    private function parentLookup($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->placing);
        if ($error || $class !== Structure::class || $index === null || $this->placingOverflow) return;
        $frame = $this->placing[$index];
        if (!$frame['source'] || $frame['structure'] !== $structure
            || $params[0] !== $this->definitions[$frame['source']['id']]['element']) return;
        $caller = LayoutXmlOwnership::caller($structure, 'hasElement');
        if (($caller['class'] ?? null) === Helper::class && ($caller['function'] ?? null) === 'scheduleElement') {
            $this->placing[$index]['lookup'] = true;
            $this->placing[$index]['expected'] = $result === true;
        }
    }

    private function completePlacement($helper, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Helper::class) return;
        if ($this->placingOverflow) { $this->placingOverflow--; return; }
        $frame = array_pop($this->placing);
        if (!$frame || $frame['structure'] !== $params[1]) {
            $this->errors['Unbalanced native layout reference child placement hook evidence'] = true;
            return;
        }
        if ($error || !$frame['source']) return;
        if ($frame['setter'] && !$frame['lookup']) $this->errors['Missing native layout reference parent lookup hook evidence'] = true;
        if ($frame['expected'] && !$frame['setter']
            && (new \ReflectionMethod($params[1], 'setAsChild'))->getDeclaringClass()->getName() === Structure::class) {
            $this->errors['Missing native layout reference parent setter hook evidence'] = true;
        }
    }

    private function read($reader, array $params, $result, ?\Throwable $error, string $class, string $method): void
    {
        if ($error || !in_array([$class, $method], [[Block::class, 'scheduleReference'], [Container::class, 'containerReference']], true)) return;
        [$schedule, $xml] = $params;
        [$ids, $context] = ($this->origin)($xml);
        $id = $ids['reference'] ?? null;
        if ($id === null || $context === null || !isset($this->definitions[$id])) return;
        $trusted = (new \ReflectionMethod($reader, $method))->getDeclaringClass()->getName() === $class
            && (new \ReflectionMethod($xml, 'getAttribute'))->getDeclaringClass()->getName() === Element::class;
        $this->seen[$id] = ($this->seen[$id] ?? true) && $trusted;
        $entries = $this->reads[$schedule] ?? [];
        $entries[$id] = ['context' => $context, 'trusted' => $trusted, 'removedSelf' => false];
        $this->reads[$schedule] = $entries;
        if (!$trusted) $this->decision($id, 'layout-reference-origin-unconfirmed', $context);
    }

    /** Called by the shared recorder, including effects from other layout adapters. */
    public function related(string $id, string $type, array $context): array
    {
        if (!isset($this->owners[$id]) || !in_array($type, self::EFFECTS, true)) return [];
        $owner = $this->owners[$id];
        if (!array_key_exists($owner, $this->seen)) {
            $this->errors['Missing native layout reference reader hook evidence'] = true;
            return [];
        }
        if (!$this->seen[$owner]) return [];
        $definition = $this->definitions[$owner];
        if ($id === $definition['removeId'] && $type === 'layout-removal-applied') {
            $frame = $this->building[array_key_last($this->building)] ?? null;
            if ($frame && isset(($this->reads[$frame['schedule']] ?? [])[$owner])) {
                $this->building[array_key_last($this->building)]['removeExpected'] = true;
                $entries = $this->reads[$frame['schedule']];
                $entries[$owner]['removedSelf'] = true;
                $this->reads[$frame['schedule']] = $entries;
            }
        }
        return [$definition['id'], $definition['nameId']];
    }

    private static function elements(object $structure): ?array
    {
        if ((new \ReflectionMethod($structure, 'hasElement'))->getDeclaringClass()->getName() !== Structure::class) return null;
        $field = LayoutXmlOwnership::unhookedProperty($structure, '_elements');
        if (!$field) return null;
        $elements = $field->getRawValue($structure);
        return is_array($elements) ? $elements : null;
    }

    private function begin($pool, array $params, string $class): void
    {
        if ($class !== GeneratorPool::class) return;
        if ($this->overflow || count($this->building) >= 256) {
            $this->overflow++;
            $this->errors['Layout reference structure nesting exceeded 256 calls'] = true;
            return;
        }
        $index = $this->processOverflow ? null : array_key_last($this->processing);
        if ($index !== null && $this->processing[$index]['pool'] === $pool) $this->processing[$index]['built'] = true;
        elseif (!$this->processOverflow && ($caller = LayoutXmlOwnership::caller($pool, 'buildStructure'))
            && ($caller['class'] ?? null) === GeneratorPool::class && ($caller['function'] ?? null) === 'process') {
            $this->errors['Missing native layout reference generator process hook evidence'] = true;
        }
        $this->building[] = ['schedule' => $params[0], 'structure' => $params[1], 'removeExpected' => false, 'removeObserved' => false,
            'trusted' => (new \ReflectionMethod($pool, 'buildStructure'))->getDeclaringClass()->getName() === GeneratorPool::class];
    }

    private function complete($pool, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== GeneratorPool::class) return;
        if ($this->overflow) { $this->overflow--; return; }
        $frame = array_pop($this->building);
        if (!$frame || $frame['schedule'] !== $params[0] || $frame['structure'] !== $params[1]) {
            $this->errors['Unbalanced native layout reference structure hook evidence'] = true;
            return;
        }
        $elements = !$error && $frame['trusted'] ? self::elements($params[1]) : null;
        if ($frame['removeExpected'] && !$frame['removeObserved']) $this->errors['Missing native layout reference removal hook evidence'] = true;
        foreach ($this->reads[$params[0]] ?? [] as $id => $entry) {
            if (!$entry['trusted']) continue;
            if ($elements === null) {
                $this->decision($id, 'layout-reference-origin-unconfirmed', $entry['context']);
                continue;
            }
            $definition = $this->definitions[$id];
            if (isset($elements[$definition['element']])) {
                $this->decision($id, 'layout-reference-target-observed', $entry['context']);
                if ($definition['empty']) $this->decision($id, 'layout-reference-unchanged', $entry['context']);
            } elseif (!$entry['removedSelf']) {
                $this->decision($id, isset(($this->removed[$params[0]] ?? [])[$definition['element']])
                    ? 'layout-reference-target-removed' : 'layout-reference-target-missing', $entry['context']);
            }
        }
        if ($elements !== null) {
            foreach ($this->attachments[$params[1]] ?? [] as $name => $entry) {
                if (($this->seen[$entry['id']] ?? false)
                    && ($elements[$name][Structure::PARENT] ?? null) === $this->definitions[$entry['id']]['element']) {
                    $this->decision($entry['id'], 'layout-reference-child-attached', $entry['context']);
                }
            }
        }
    }

    private function beginRemoval($pool, array $params, string $class): void
    {
        if ($class !== GeneratorPool::class) return;
        if ($this->removalOverflow || count($this->removing) >= 256) {
            $this->removalOverflow++;
            $this->errors['Layout reference removal nesting exceeded 256 calls'] = true;
            return;
        }
        $index = array_key_last($this->building);
        if ($index !== null && !$this->overflow) $this->building[$index]['removeObserved'] = true;
        $before = [];
        $elements = self::elements($params[1]);
        if ($elements !== null && !($params[3] ?? false)) {
            foreach ($this->reads[$params[0]] ?? [] as $id => $entry) {
                $name = $this->definitions[$id]['element'];
                if (isset($elements[$name])) $before[$name] = true;
            }
        }
        $this->removing[] = $before;
    }

    private function completeRemoval($pool, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== GeneratorPool::class) return;
        if ($this->removalOverflow) { $this->removalOverflow--; return; }
        $before = array_pop($this->removing);
        if ($before === null) $this->errors['Unbalanced native layout reference removal hook evidence'] = true;
        $after = !$error ? self::elements($params[1]) : null;
        if ($after === null || !$before) return;
        $removed = $this->removed[$params[0]] ?? [];
        foreach ($before as $name => $_) if (!isset($after[$name])) $removed[$name] = true;
        $this->removed[$params[0]] = $removed;
    }

    private function decision(string $id, string $type, array $context): void
    {
        foreach ([$id, $this->definitions[$id]['nameId']] as $source) Recorder::layout($source, $type, $context);
    }

    private function beginProcess($pool, array $params, string $class): void
    {
        if ($class !== GeneratorPool::class) return;
        if ($this->processOverflow || count($this->processing) >= 256) {
            $this->processOverflow++;
            $this->errors['Layout reference generator process nesting exceeded 256 calls'] = true;
            return;
        }
        $field = LayoutXmlOwnership::unhookedProperty($params[0], 'scheduledStructure');
        $schedule = $field && (new \ReflectionMethod($params[0], 'getScheduledStructure'))->getDeclaringClass()->getName() === Context::class
            ? $field->getRawValue($params[0]) : null;
        $this->processing[] = ['pool' => $pool, 'expected' => $schedule && isset($this->reads[$schedule]), 'built' => false];
    }

    private function completeProcess($pool, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== GeneratorPool::class) return;
        if ($this->processOverflow) { $this->processOverflow--; return; }
        $frame = array_pop($this->processing);
        if (!$frame || $frame['pool'] !== $pool) {
            $this->errors['Unbalanced native layout reference generator process hook evidence'] = true;
        } elseif (!$error && $frame['expected'] && !$frame['built']) {
            $this->errors['Missing native layout reference structure hook evidence'] = true;
        }
    }

    public function finish(): void
    {
        if ($this->building || $this->removing || $this->processing || $this->scheduling || $this->placing
            || $this->overflow || $this->removalOverflow || $this->processOverflow || $this->scheduleOverflow || $this->placingOverflow) {
            $this->errors['Unbalanced native layout reference hook evidence'] = true;
        }
        if ($this->errors) throw new \RuntimeException(implode(', ', array_keys($this->errors)));
    }
}
