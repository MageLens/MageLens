<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\ObserverOverride;

use Magento\Framework\Event\{Observer, ObserverInterface};

class ExternalObserver implements ObserverInterface
{
    public function execute(Observer $observer): void
    {
        $observer->getData('counter')->setData('external', true);
    }
}
