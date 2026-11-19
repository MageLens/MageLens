<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);

namespace MageLens\Compatibility\Controller\Handle;

use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\App\RequestInterface;
use Magento\Framework\App\ViewInterface;
use Magento\Framework\View\Result\Page;
use Magento\Framework\View\Result\PageFactory;

class Index implements HttpGetActionInterface
{
    // Resolve the application view before layout generation can request it.
    public function __construct(private PageFactory $pages, private RequestInterface $request, ViewInterface $view,
        private \Magento\Framework\App\Cache\Type\Config $configCache)
    {
    }

    public function execute(): Page
    {
        $this->configCache->remove('page_types_config');
        if ($this->request->getParam('variant') === 'page-values') {
            $page = $this->pages->create(true, ['isIsolated' => true]);
            $page->addHandle('default');
            $page->addHandle('coverageprobe_page_values_base');
            $page->addHandle('coverageprobe_page_values_falsy');
            return $page;
        }
        $page = $this->pages->create();
        if ($this->request->getParam('variant') === 'selected') {
            $page->getLayout()->getUpdate()->addHandle('coverageprobe_layout_dynamic');
        }
        return $page;
    }
}
