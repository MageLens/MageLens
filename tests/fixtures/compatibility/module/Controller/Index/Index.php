<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Index;
class Index implements \Magento\Framework\App\Action\HttpGetActionInterface
{
    // Resolve the application view before layout generation can request it.
    public function __construct(
        private \Magento\Framework\View\Result\PageFactory $pages,
        \Magento\Framework\App\ViewInterface $view
    ) {}
    public function execute() { return $this->pages->create(); }
}
