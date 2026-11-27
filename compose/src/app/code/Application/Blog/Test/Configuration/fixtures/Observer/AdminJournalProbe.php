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
    public function __construct(private \Application\Blog\Model\JournalPluginSubject $pluginSubject) {}

    public function execute(Observer $observer): void
    {
        $preference = \Magento\Framework\App\ObjectManager::getInstance()->get('Application\Blog\Model\JournalAreaPreference');
        $observer->getData('response')->setHeader('X-MageLens-Admin-Preference', $preference instanceof \Application\Blog\Model\JournalPluginSubject ? 'resolved' : 'unexpected', true);
        $argument = \Magento\Framework\App\ObjectManager::getInstance()->get('Application\Blog\Model\JournalArgumentAlias');
        $observer->getData('response')->setHeader('X-MageLens-Admin-Argument', $argument->label, true);
        $observer->getData('response')->setHeader('X-MageLens-Admin-Observer', 'executed', true);
        $observer->getData('response')->setHeader('X-MageLens-Admin-Plugin', $this->pluginSubject->probe('start'), true);
    }
}
