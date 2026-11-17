<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

namespace MageLens\Compatibility\Model;

use Magento\Framework\Data\OptionSourceInterface;
use Magento\Framework\View\Element\Block\ArgumentInterface;
use Magento\Framework\View\Layout\Argument\UpdaterInterface;

class LayoutArgumentSource implements ArgumentInterface, OptionSourceInterface, UpdaterInterface
{
    public const MATRIX = ['constant' => 'fixture'];

    public function toOptionArray(): array
    {
        return ['fixture-option' => 'Fixture label'];
    }

    public function join(string $first, string $second): string
    {
        return $first . ':' . $second;
    }

    public function update($value)
    {
        $value[0]['label'] .= ' updated';
        return $value;
    }
}
