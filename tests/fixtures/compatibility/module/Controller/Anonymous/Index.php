<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Anonymous;

class Index implements \Magento\Framework\App\Action\HttpGetActionInterface
{
    public function __construct(private \Magento\Framework\View\Result\LayoutFactory $layouts)
    {
    }

    public function execute(): \Magento\Framework\View\Result\Layout
    {
        return $this->layouts->create();
    }
}
