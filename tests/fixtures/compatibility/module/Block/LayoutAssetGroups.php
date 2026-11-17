<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Block;

use Magento\Framework\View\Element\Template;

class LayoutAssetGroups extends Template
{
    public function hasExpectedGroups(): bool
    {
        $groups = [];
        foreach ($this->pageConfig->getAssetCollection()->getGroups() as $group) {
            foreach (['layout-head.css', 'layout-second.css'] as $file) {
                if ($group->has('MageLens_Compatibility::css/' . $file)) $groups[$file] = $group;
            }
        }
        return isset($groups['layout-head.css'], $groups['layout-second.css'])
            && $groups['layout-head.css'] !== $groups['layout-second.css']
            && $groups['layout-head.css']->getProperty('order') === '70'
            && $groups['layout-second.css']->getProperty('order') === '10';
    }
}
