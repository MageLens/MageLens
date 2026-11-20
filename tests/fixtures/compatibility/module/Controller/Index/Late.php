<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Index;
// Still runs when the test that requested it has finished, so its coverage must stay with that test's attempt.
class Late implements \Magento\Framework\App\Action\HttpGetActionInterface
{
    public function __construct(private \Magento\Framework\Controller\Result\RawFactory $raw) {}
    public function execute()
    {
        usleep(2000000);
        return $this->raw->create()->setHeader('Content-Type', 'text/plain; charset=UTF-8', true)->setContents('late');
    }
}
