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
    public function structureEffects(): array
    {
        $layout = $this->getLayout();
        $wrapper = $layout->getBlock('magelens_layout_ui');
        $children = $layout->getChildNames('magelens.layout.component');
        $group = $layout->getGroupChildNames('magelens.layout.component', 'fixture-ui-group');
        sort($group);
        $output = (new \ReflectionProperty(\Magento\Framework\View\Layout::class, '_output'))->getValue($layout);
        return [
            'alias' => $layout->getChildName('magelens.layout.component', 'ui.alias') === 'magelens_layout_ui',
            'ordering' => $children === ['magelens_layout_ui_before', 'magelens.layout.ui-anchor',
                'magelens_layout_ui', 'magelens.layout.ui-proof', 'magelens.layout.ui-hidden'],
            'group' => $group === ['magelens_layout_ui', 'magelens_layout_ui_before'],
            'visibility' => !$layout->hasElement('magelens_layout_ui_denied')
                && !$layout->hasElement('magelens_layout_ui_config_denied'),
            'calls' => count(array_filter(\MageLens\Compatibility\Model\LayoutVisibility::$decisions)) === 3
                && count(\MageLens\Compatibility\Model\LayoutVisibility::$decisions) === 4,
            'cacheable' => $layout->isCacheable(),
            'ttl' => $wrapper->getData('ttl') === null,
            'output' => $layout->getBlock('magelens_layout_ui_detached') instanceof UiComponent
                && $layout->getParentName('magelens_layout_ui_detached') === 'magelens.layout.ui-hidden'
                && !isset($output['magelens_layout_ui_detached']),
        ];
    }
}
