<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Observer;

use Magento\Framework\Event\Observer;
use Magento\Framework\Event\ObserverInterface;
use Magento\Framework\View\Page\Config;

class LayoutReplacement implements ObserverInterface
{
    public function __construct(private Config $pageConfig)
    {
    }

    public function execute(Observer $observer): void
    {
        $layout = $observer->getLayout();
        if (!in_array('coverageprobe_handle_index', $layout->getUpdate()->getHandles(), true)) return;
        $this->pageConfig->setMetadata('magelens-replaced', 'same');
        $this->pageConfig->setElementAttribute('body', 'data-layout-replaced', 'same');
        $property = new \ReflectionProperty(\Magento\Framework\View\Layout::class, 'structure');
        $property->getValue($layout)->setAttribute('magelens.layout.right', 'htmlId', 'layout-right');
    }
}
