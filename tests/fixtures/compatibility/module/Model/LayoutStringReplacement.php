<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutStringReplacement
{
    public static int $calls = 0;

    public function aroundAsString(\Magento\Framework\View\Model\Layout\Merge $merge, \Closure $proceed): string
    {
        self::$calls++;
        return implode('', $merge->asArray());
    }
}
