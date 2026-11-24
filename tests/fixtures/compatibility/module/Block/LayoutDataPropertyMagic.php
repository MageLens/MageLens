<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Block;

class LayoutDataPropertyMagic extends \Magento\Framework\View\Element\Template
{
    public static int $reads = 0;
    private array $replacement = [];

    protected function _beforeToHtml()
    {
        $this->replacement = $this->_data;
        $this->replacement['value'] = 'xml-value';
        unset($this->_data);
        return parent::_beforeToHtml();
    }

    public function &__get($key)
    {
        if ($key !== '_data') throw new \LogicException('Unexpected fixture property read');
        self::$reads++;
        return $this->replacement;
    }

    public function __set($key, $value)
    {
        if ($key !== '_data') throw new \LogicException('Unexpected fixture property assignment');
        $this->replacement = $value;
    }
}
