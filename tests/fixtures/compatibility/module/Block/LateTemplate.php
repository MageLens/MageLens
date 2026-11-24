<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);

namespace MageLens\Compatibility\Block;

use Magento\Framework\View\Element\Template;

class LateTemplate extends Template
{
    protected function _beforeToHtml()
    {
        $this->setTemplate('MageLens_Compatibility::layout-late.phtml');
        return parent::_beforeToHtml();
    }
}
