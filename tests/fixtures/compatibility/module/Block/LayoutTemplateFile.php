<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Block;

class LayoutTemplateFile extends \Magento\Framework\View\Element\Template
{
    public function getTemplateFile($template = null)
    {
        return parent::getTemplateFile('MageLens_Compatibility::layout-mutation.phtml');
    }
}
