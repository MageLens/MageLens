<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Block;

class LayoutGeneric extends \Magento\Framework\View\Element\Template
{
    private array $calls = [];

    public function markGeneric(string $value): void
    {
        $this->calls[] = $value;
    }

    public function hasExpectedEffects(): bool
    {
        $layout = $this->getLayout();
        return $this->calls === ['generic'] && $this->getData('value') === 'generic-value'
            && $this->getData('matrix/nested') === 'leaf'
            && $layout->getParentName('magelens.layout.generic.moved') === 'magelens.layout.generic.right'
            && $layout->getChildName('magelens.layout.generic.right', 'generic-moved') === 'magelens.layout.generic.moved'
            && !$layout->hasElement('magelens.layout.generic.removed');
    }
}
