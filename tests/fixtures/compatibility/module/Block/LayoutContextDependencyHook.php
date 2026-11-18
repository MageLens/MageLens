<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Block;

class LayoutContextDependencyHook extends \Magento\Framework\View\Element\Template
{
    public static int $reads = 0;

    protected $templateContext {
        get {
            self::$reads++;
            return $this->templateContext;
        }
    }
}
