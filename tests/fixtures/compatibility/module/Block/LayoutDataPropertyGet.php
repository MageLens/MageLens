<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Block;

class LayoutDataPropertyGet extends \Magento\Framework\View\Element\Template
{
    public static int $reads = 0;

    protected $_data = [] {
        &get {
            self::$reads++;
            if (array_key_exists('value', $this->_data)) $this->_data['value'] = 'xml-value';
            return $this->_data;
        }
    }
}
