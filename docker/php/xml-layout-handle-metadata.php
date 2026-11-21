<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\Simplexml\Element;
use Magento\Framework\View\Layout\ProcessorInterface;
use Magento\Framework\View\Model\Layout\Merge;

/** Native metadata evaluation is distinct from later PHP array consumption. */
final class LayoutHandleMetadata
{
    private array $reading = [];
    private int $overflow = 0;
    private array $errors = [];
    private bool $snapshot = false;

    public function __construct(private readonly LayoutXmlOwnership $ownership, private readonly \Closure $origin)
    {
    }

    public function hooks(): array
    {
        return [[ProcessorInterface::class, 'getAllDesignAbstractions', $this->begin(...), $this->complete(...)],
            [Element::class, 'getAttribute', null, $this->attribute(...)]];
    }

    private function begin($merge, array $params, string $class): void
    {
        if (!$merge instanceof Merge) return;
        if ($this->ownership->producerDepth($merge, 'getAllDesignAbstractions') === 0) {
            if ($this->overflow || count($this->reading) >= 256) {
                $this->overflow++;
                $this->errors['Handle metadata nesting exceeded 256 calls'] = true;
            } else $this->reading[] = ['merge' => $merge, 'entries' => [], 'last' => [], 'observed' => false];
        }
        $caller = LayoutXmlOwnership::caller($merge, 'getAllDesignAbstractions', false);
        $delegated = ($caller['class'] ?? null) === get_class($merge)
            && ($caller['function'] ?? null) === 'getAllDesignAbstractions';
        $this->ownership->beginProducer($merge, Merge::class, $class, 'getAllDesignAbstractions', true, $delegated);
    }

    private function attribute($xml, array $params, $value, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->reading);
        if ($error || $this->overflow || $class !== Element::class
            || !in_array($params[0] ?? null, ['label', 'design_abstraction'], true)) return;
        $caller = LayoutXmlOwnership::caller($xml, 'getAttribute');
        if (($caller['class'] ?? null) !== Merge::class || ($caller['function'] ?? null) !== 'getAllDesignAbstractions') return;
        if ($index === null || ($caller['object'] ?? null) !== $this->reading[$index]['merge']) {
            $this->errors['Missing native handle metadata hook evidence'] = true;
            return;
        }
        $this->reading[$index]['observed'] = true;
        $node = dom_import_simplexml($xml);
        $key = $node->getNodePath();
        if (count($this->reading[$index]['entries']) >= 8192 && !isset($this->reading[$index]['entries'][$key])) {
            $this->errors['Handle metadata exceeded 8192 entries'] = true;
            return;
        }
        [$ids, $context] = ($this->origin)($this->reading[$index]['merge'], $xml);
        $kind = $params[0] === 'label' ? 'label' : 'type';
        $id = $ids['handle-' . $kind] ?? null;
        if ($id !== null && $context !== null) Recorder::layout($id, 'layout-handle-' . $kind . '-evaluated', $context);
        $entry = $this->reading[$index]['entries'][$key] ?? ['ids' => $ids, 'context' => $context, 'fields' => []];
        $entry['fields'][$kind] = true;
        $this->reading[$index]['entries'][$key] = $entry;
        $this->reading[$index]['last'][$node->getAttribute('id')] = $key;
    }

    private function complete($merge, array $params, $result, ?\Throwable $error): void
    {
        if (!$merge instanceof Merge) return;
        $proof = $this->ownership->endProducer($merge, 'getAllDesignAbstractions', $error);
        if (!$proof['final']) return;
        if ($this->overflow) { $this->overflow--; return; }
        $frame = array_pop($this->reading);
        if (!$frame || $frame['merge'] !== $merge) {
            $this->errors['Unbalanced handle metadata hook evidence'] = true;
            return;
        }
        if ($error) return;
        $this->snapshot = true;
        if ($proof['trusted'] && $result && !$frame['observed']) {
            $this->errors['Missing native handle metadata attribute hook evidence'] = true;
        }
        $winners = array_flip(array_values($frame['last']));
        foreach ($frame['entries'] as $key => $entry) {
            if ($proof['trusted'] && count($entry['fields']) !== 2) {
                $this->errors['Missing native handle metadata attribute hook evidence'] = true;
            }
            if ($entry['context'] === null) continue;
            $effect = !$proof['trusted'] ? 'layout-handle-metadata-origin-unconfirmed'
                : (isset($winners[$key]) ? 'layout-handle-metadata-returned' : 'layout-handle-metadata-overridden');
            foreach (['handle-label', 'handle-type'] as $kind) {
                if (isset($entry['ids'][$kind])) Recorder::layout($entry['ids'][$kind], $effect, $entry['context']);
            }
        }
    }

    public function finish(): array
    {
        if ($this->reading || $this->overflow) $this->errors['Unbalanced handle metadata hook evidence'] = true;
        if ($this->errors) throw new \RuntimeException(implode(', ', array_keys($this->errors)));
        return $this->snapshot ? ['layout-handle-metadata-snapshot'] : [];
    }
}
