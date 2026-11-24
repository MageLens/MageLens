<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
namespace Application\Blog\Controller\Index;

use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\App\ViewInterface;
use Magento\Framework\View\Result\PageFactory;

class Index implements HttpGetActionInterface
{
    // Resolve the application view before layout generation can request it.
    public function __construct(private PageFactory $pages, ViewInterface $view) {}

    public function execute()
    {
        $page = $this->pages->create();
        $page->getConfig()->getTitle()->set('Journal');
        return $page;
    }
}
