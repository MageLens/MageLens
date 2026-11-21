<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

namespace MageLens\UiProbe\Plugin;

use Magento\Ui\Component\Listing\Columns\Column;

final class LabelReplacement
{
    public function beforePrepare(Column $column): void
    {
        if (!in_array($column->getName(), ['before_different', 'before_equal'], true)) return;
        $config = $column->getConfiguration();
        if ($column->getName() === 'before_equal' && $config['label'] !== 'Equal PHP column') {
            throw new \RuntimeException('Expected the same native XML and PHP label value');
        }
        $config['label'] = $column->getName() === 'before_different' ? 'Before prepare replacement' : 'Equal PHP column';
        $column->setData('config', $config);
    }

    public function afterGetConfiguration(Column $column, array $config): array
    {
        if ($column->getName() === 'after_configuration') {
            $config['label'] = 'Serialized replacement';
        }
        return $config;
    }

    public function afterPrepare(Column $column): void
    {
        if ($column->getName() !== 'after_prepare') return;
        $config = $column->getConfiguration();
        $config['label'] = 'After prepare replacement';
        $column->setData('config', $config);
    }
}
