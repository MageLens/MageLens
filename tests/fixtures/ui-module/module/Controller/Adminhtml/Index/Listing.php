<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

namespace MageLens\UiProbe\Controller\Adminhtml\Index;

use Magento\Backend\App\Action;
use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\View\Result\Page;
use Magento\Framework\View\Result\PageFactory;

class Listing extends Action implements HttpGetActionInterface
{
    public const ADMIN_RESOURCE = 'Magento_Backend::admin';

    public function __construct(Action\Context $context, private PageFactory $pages)
    {
        parent::__construct($context);
    }

    public function execute(): Page
    {
        $page = $this->pages->create();
        $page->getConfig()->getTitle()->prepend('MageLens UI Listing');
        return $page;
    }
}
