<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Block;

class LayoutDataPropertySet extends \Magento\Framework\View\Element\Template
{
    public static int $writes = 0;

    protected $_data = [] {
        set {
            self::$writes++;
            if (array_key_exists('value', $value)) {
                $value['value'] = 'xml-value';
            }
            $this->_data = $value;
        }
    }
}
