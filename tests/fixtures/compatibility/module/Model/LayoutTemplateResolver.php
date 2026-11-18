<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutTemplateResolver extends \Magento\Framework\View\Element\Template\File\Resolver
{
    public function getTemplateFileName($template, $params = [])
    {
        return parent::getTemplateFileName('MageLens_Compatibility::layout-mutation.phtml', $params);
    }
}
