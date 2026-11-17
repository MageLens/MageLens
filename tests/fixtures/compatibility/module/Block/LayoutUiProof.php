<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Block;

use Magento\Framework\View\Element\Template;
use Magento\Ui\Component\Container;
use Magento\Ui\Component\HtmlContent;
use Magento\Ui\Component\Wrapper\UiComponent;

class LayoutUiProof extends Template
{
    public function hasExpectedPlacement(): bool
    {
        $wrapper = $this->getLayout()->getBlock('magelens_layout_ui');
        if (!$wrapper instanceof UiComponent) return false;
        $property = new \ReflectionProperty(UiComponent::class, 'component');
        $component = $property->getValue($wrapper);
        return $component instanceof Container && $component->getName() === 'magelens_layout_ui'
            && $component->getComponent('fixture') instanceof HtmlContent
            && $component->getData('layout_only') === null
            && $wrapper->getData('layout_only') === null
            && $this->getLayout()->getParentName('magelens_layout_ui') === 'magelens.layout.component';
    }
}
