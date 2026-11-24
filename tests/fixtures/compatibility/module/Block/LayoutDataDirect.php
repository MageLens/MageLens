<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Block;

class LayoutDataDirect extends \Magento\Framework\View\Element\Template
{
    public static int $writes = 0;
    protected function _beforeToHtml()
    {
        self::$writes++;
        $this->_data['value'] = 'xml-value';
        $this->_data['nested']['child'] = 'xml-leaf';
        return parent::_beforeToHtml();
    }
}
