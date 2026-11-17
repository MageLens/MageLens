<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutConfiguredData extends \Magento\Framework\DataObject implements
    \Magento\Framework\View\Element\Block\ArgumentInterface,
    \Magento\Framework\Data\OptionSourceInterface
{
    public function toOptionArray(): array
    {
        return [];
    }
}
