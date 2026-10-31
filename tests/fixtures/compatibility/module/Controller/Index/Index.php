<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Index;
class Index implements \Magento\Framework\App\Action\HttpGetActionInterface
{
    public function __construct(private \Magento\Framework\View\Result\PageFactory $pages) {}
    public function execute() { return $this->pages->create(); }
}
