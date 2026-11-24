<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutConditionPlugin
{
    public static int $calls = 0;

    public function afterParseConditions(
        \Magento\Framework\View\Layout\Reader\Visibility\Condition $reader,
        array $result
    ): array {
        self::$calls++;
        return array_replace_recursive([], $result);
    }
}
