<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Block;

class LayoutTemplatePropertyMagic extends \Magento\Framework\View\Element\Template
{
    public static int $reads = 0;
    public static int $writes = 0;

    protected function _construct()
    {
        parent::_construct();
        unset($this->_template);
    }

    public function __get($key)
    {
        if ($key !== '_template') throw new \LogicException('Unexpected fixture property read');
        self::$reads++;
        return 'MageLens_Compatibility::layout-property.phtml';
    }

    public function __set($key, $value)
    {
        if ($key !== '_template') throw new \LogicException('Unexpected fixture property assignment');
        self::$writes++;
    }
}
