<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutPackageObserver implements \Magento\Framework\Event\ObserverInterface
{
    public static int $calls = 0;

    public function execute(\Magento\Framework\Event\Observer $observer): void
    {
        $xml = $observer->getData('layoutXml');
        $matches = $xml->xpath('./*[@id="coverageprobe_packagemutation_native"]//block');
        if (!$matches) return;
        self::$calls++;
        $node = dom_import_simplexml($matches[0]);
        $node->parentNode->replaceChild($node->cloneNode(true), $node);
    }
}
