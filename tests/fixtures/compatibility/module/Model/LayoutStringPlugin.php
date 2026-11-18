<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutStringPlugin
{
    public static int $strings = 0;

    public function afterAsString(\Magento\Framework\View\Model\Layout\Merge $merge, string $result): string
    {
        self::$strings++;
        return substr($result, 0);
    }

}
