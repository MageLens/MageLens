<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace JournalObserverForTest;

use Magento\Framework\Event\Observer;
use Magento\Framework\Interception\InterceptorInterface;

class Interceptor extends \JournalObserverForTest implements InterceptorInterface
{
    use \Magento\Framework\Interception\Interceptor;

    public bool $shortCircuit = false;
    public function execute(Observer $observer): void
    {
        if (!$this->shortCircuit) $this->___callParent('execute', [new Observer()]);
    }
}
