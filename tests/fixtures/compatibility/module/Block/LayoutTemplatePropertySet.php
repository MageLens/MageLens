<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Block;

class LayoutTemplatePropertySet extends \Magento\Framework\View\Element\Template
{
    public static int $writes = 0;

    protected $_template {
        set {
            self::$writes++;
            $this->_template = 'MageLens_Compatibility::layout-property.phtml';
        }
    }
}
