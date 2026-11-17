<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutConditionReplacement extends \Magento\Framework\View\Layout\Reader\Visibility\Condition
{
    public function __construct(private \Magento\Framework\View\Layout\Reader\Visibility\Condition $original)
    {
    }

    public function parseConditions(\Magento\Framework\Simplexml\Element $element)
    {
        return array_replace_recursive([], $this->original->parseConditions($element));
    }
}
