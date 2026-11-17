<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);

namespace MageLens\Compatibility\Block;

use Magento\Framework\View\Element\Template;

class LayoutStructure extends Template
{
    public function hasExpectedStructure(): bool
    {
        $layout = $this->getLayout();
        $left = 'magelens.layout.left';
        $right = 'magelens.layout.right.nested';
        $moved = 'magelens.layout.moved';

        return $layout->getParentName($moved) === $right
            && $layout->getChildName($right, 'moved-alias') === $moved
            && !$layout->getChildName($left, 'starting-alias')
            && !$layout->getParentName('magelens.layout.absent')
            && !$layout->getBlock('magelens.layout.moved-removed')
            && $layout->getBlock('magelens.layout.restored') instanceof Template
            && $layout->getBlock('magelens.layout.hidden') instanceof Template
            && $layout->getBlock('magelens.layout.anchor') instanceof Template
            && $layout->getBlock('magelens.layout.anchor')->getTtl() === 17
            && $layout->getGroupChildNames($right, 'effective-group') === ['magelens.layout.anchor']
            && $layout->getGroupChildNames($right, 'original-group') === [];
    }
}
