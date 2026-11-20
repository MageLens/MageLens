<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Block;

class LayoutLockDependencyShadow extends \Magento\Framework\View\Element\Template
{
    public static int $reads = 0;

    private $lockQuery {
        get { self::$reads++; return null; }
    }
}
