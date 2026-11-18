<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

/** Original parser keys inherit proven assignments, independently of value reads. */
final class LayoutArgumentNames
{
    private const VALUES = [
        'layout-argument-applied' => 'layout-argument-name-applied',
        'layout-argument-overridden' => 'layout-argument-name-overridden',
        'layout-argument-mixed-origin' => 'layout-argument-name-mixed-origin',
        'layout-argument-origin-unconfirmed' => 'layout-argument-name-origin-unconfirmed',
        'layout-argument-identity-unconfirmed' => 'layout-argument-name-origin-unconfirmed',
        'layout-argument-application-unconfirmed' => 'layout-argument-name-origin-unconfirmed',
    ];
    private const ACTIONS = [
        'layout-action-argument-applied' => 'layout-action-argument-name-applied',
        'layout-action-argument-ambiguous' => 'layout-action-argument-name-ambiguous',
        'layout-argument-origin-unconfirmed' => 'layout-action-argument-name-origin-unconfirmed',
    ];
    private array $origins = [];

    public function __construct(array $sources)
    {
        foreach ($sources as $source) {
            foreach ($source['targets'] as $target) {
                foreach (['argument' => 'argument-name', 'action-argument' => 'action-argument-name'] as $value => $name) {
                    if (isset($target['ids'][$value], $target['ids'][$name])) {
                        if (!isset($this->origins[$target['ids'][$value]]) && count($this->origins) >= 32768) {
                            throw new \RuntimeException('Layout argument name inventory exceeded 32768 operands');
                        }
                        $this->origins[$target['ids'][$value]] = ['id' => $target['ids'][$name], 'action' => $value === 'action-argument'];
                    }
                }
            }
        }
    }

    public function related(string $id, string $type): ?array
    {
        $origin = $this->origins[$id] ?? null;
        if ($origin === null) return null;
        $effect = ($origin['action'] ? self::ACTIONS : self::VALUES)[$type] ?? null;
        return $effect === null ? null : [$origin['id'], $effect];
    }
}
