<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
namespace Application\Blog\Controller\Adminhtml\Manage;

use Application\Blog\Model\Editor;
use Magento\Backend\App\Action\Context;
use Magento\Framework\View\Result\PageFactory;
use Psr\Log\LoggerInterface;

abstract class Action extends \Magento\Backend\App\Action
{
    public const ADMIN_RESOURCE = 'Application_Blog::manage';
    public function __construct(Context $context, protected Editor $editor, protected PageFactory $pages, protected LoggerInterface $logger)
    {
        parent::__construct($context);
    }
    protected function section(): string { return $this->editor->section((string) $this->getRequest()->getParam('section', 'posts')); }
    protected function page(string $title)
    {
        $page = $this->pages->create();
        $page->setActiveMenu('Application_Blog::' . $this->section());
        $page->getConfig()->getTitle()->prepend(__($title));
        return $page;
    }
}
