<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\View\Element\AbstractBlock;

final class LayoutBlockArguments
{
    private \WeakMap $bindings;
    private LayoutFieldAccess $fields;

    public function __construct(private readonly \Closure $event, private readonly \Closure $unconfirmed,
        private readonly \Closure $digest, private readonly \Closure $matches)
    {
        $this->bindings = new \WeakMap();
        $this->fields = new LayoutFieldAccess('_data', AbstractBlock::class, 'Block data');
    }

    public function hooks(): array
    {
        return $this->fields->hooks();
    }

    public function finish(): void
    {
        $this->fields->finish();
    }

    public function applied(AbstractBlock $block, array $origins, array $context): void
    {
        if (!$origins) return;
        $previous = $this->bindings[$block]['origins'] ?? [];
        $this->bindings[$block] = ['origins' => array_replace($previous, $origins), 'context' => $context];
    }

    public function invalidate(AbstractBlock $block, ?array $keys): void
    {
        $binding = $this->bindings[$block] ?? null;
        if (!$binding) return;
        if ($keys !== null) $keys = array_map(self::dataKey(...), $keys);
        $removed = $keys === null ? $binding['origins'] : array_intersect_key($binding['origins'], array_fill_keys($keys, true));
        foreach (self::ids($removed) as $id) ($this->event)($id, 'layout-argument-replaced', $binding['context']);
        $binding['origins'] = array_diff_key($binding['origins'], $removed);
        $this->bindings[$block] = $binding;
    }

    private static function dataKey($key): string|int
    {
        return is_bool($key) || is_float($key) || is_resource($key) ? (int) $key : ($key ?? '');
    }

    public function read(AbstractBlock $block, array $params, $value, string $function): void
    {
        if (!isset($this->bindings[$block])) return;
        $key = $params[0] ?? null;
        if (!is_scalar($key) && $key !== null) return;
        if ($function === 'getData' && ($key === null || $key === '')) return;
        $binding = $this->bindings[$block];
        $origins = $binding['origins'];
        $data = LayoutXmlOwnership::unhookedProperty($block, '_data');
        if ($data === null) {
            foreach ($origins as $origin) ($this->unconfirmed)($origin, $binding['context'], 'layout-argument-storage-unconfirmed');
            unset($this->bindings[$block]);
            return;
        }
        $values = $data->getRawValue($block);
        $path = $function === 'getDataByPath'
            || ($function === 'getData' && !isset($values[$key]) && str_contains((string) $key, '/'));
        if ($path && $value === null) return;
        $keys = $path ? explode('/', (string) $key) : [self::dataKey($key)];
        $origin = null;
        foreach ($keys as $part) {
            if (!is_array($values) || !array_key_exists($part, $values)) return;
            $values = $values[$part];
            $origin = $origins[$part] ?? null;
            $origins = $origin['children'] ?? [];
        }
        if ($function === 'getData' && ($params[1] ?? null) !== null) {
            // Native array projections consume one existing non-null member.
            // String projections split the original value at native EOLs.
            if ($value === null) return;
            if (is_array($values)) {
                $origin = $origins[self::dataKey($params[1])] ?? null;
            } elseif (is_string($values)) {
                $value = $values;
            } else return;
        }
        if ($origin !== null && $this->fields->unconfirmed($block)) {
            foreach (self::ids($binding['origins']) as $id) ($this->event)($id, 'layout-argument-field-access-unconfirmed', $binding['context']);
            unset($this->bindings[$block]);
            return;
        }
        $matched = isset($origin['digest']) && (is_scalar($value) || $value === null)
            && ($this->digest)([$value]) === $origin['digest'];
        $matched = $matched || (isset($origin['value']) && ($this->matches)($origin['value'], $value));
        if (isset($origin['id']) && $matched) {
            ($this->event)($origin['id'], 'layout-argument-read', $binding['context']);
        }
    }

    public static function ids(array $origins): array
    {
        $ids = [];
        foreach ($origins as $origin) {
            if (isset($origin['id'])) $ids[] = $origin['id'];
            if (isset($origin['children'])) array_push($ids, ...self::ids($origin['children']));
        }
        return $ids;
    }
}
