<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Block;

class LayoutTemplateDirect extends \Magento\Framework\View\Element\Template
{
    public static int $writes = 0;
    protected function _beforeToHtml()
    {
        self::$writes++;
        $this->_template = 'MageLens_Compatibility::layout-template-value.phtml';
        return parent::_beforeToHtml();
    }
}
