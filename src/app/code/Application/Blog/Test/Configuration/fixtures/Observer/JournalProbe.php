<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace Application\Blog\Observer;

use Magento\Framework\Event\{Observer, ObserverInterface};

class JournalProbe implements ObserverInterface
{
    public function execute(Observer $observer): void
    {
        $counter = $observer->getData('counter');
        $counter->setData('hits', $counter->getData('hits') + 1);
    }
}
