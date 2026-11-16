<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace Application\Blog\Observer;

use Magento\Framework\Event\{Observer, ObserverInterface};

class AdminJournalProbe implements ObserverInterface
{
    public function execute(Observer $observer): void
    {
        $observer->getData('response')->setHeader('X-MageLens-Admin-Observer', 'executed', true);
    }
}
