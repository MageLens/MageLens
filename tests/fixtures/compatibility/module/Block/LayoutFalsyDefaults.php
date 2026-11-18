<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Block;

class LayoutFalsyDefaults extends \Magento\Framework\View\Element\Template
{
    protected $_template = 'MageLens_Compatibility::layout-falsy.phtml';

    protected function _construct()
    {
        parent::_construct();
        $this->setTtl(29);
    }
}
