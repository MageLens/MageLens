<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Block;

class LayoutTemplatePropertyGet extends \Magento\Framework\View\Element\Template
{
    public static int $reads = 0;

    protected $_template {
        get {
            self::$reads++;
            return 'MageLens_Compatibility::layout-property.phtml';
        }
        set { $this->_template = $value; }
    }
}
