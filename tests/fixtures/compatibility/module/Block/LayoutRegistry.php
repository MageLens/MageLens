<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);

namespace MageLens\Compatibility\Block;

use Magento\Framework\View\Element\Template;
use Magento\Framework\View\Model\PageLayout\Config\BuilderInterface;

class LayoutRegistry extends Template
{
    public function __construct(Template\Context $context, private BuilderInterface $pageLayouts, array $data = [])
    {
        parent::__construct($context, $data);
    }

    public function wireframeEffects(): array
    {
        $layout = $this->getLayout();
        return [
            'move' => $layout->getParentName('magelens.layout.wireframe.movable') === 'magelens.layout.wireframe',
            'removal' => !$layout->hasElement('magelens.layout.wireframe.removed'),
            'nested-block' => $layout->getBlock('magelens.layout.wireframe.nested-block') instanceof Template,
            'ignored-body' => !$layout->hasElement('magelens.layout.wireframe.ignored-body'),
        ];
    }

    public function fixtureLayoutLabel(): string
    {
        return $this->pageLayouts->getPageLayoutsConfig()->getOptions()['magelens_fixture'] ?? '';
    }
}
