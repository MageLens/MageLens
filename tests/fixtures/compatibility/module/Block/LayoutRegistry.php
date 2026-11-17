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

    public function fixtureLayoutLabel(): string
    {
        return $this->pageLayouts->getPageLayoutsConfig()->getOptions()['magelens_fixture'] ?? '';
    }
}
