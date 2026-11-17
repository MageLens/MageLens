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
use Magento\Framework\View\Result\Page;
use Magento\Framework\View\Result\PageFactory;

class Index implements HttpGetActionInterface
{
    public function __construct(private PageFactory $pages, private RequestInterface $request)
    {
    }

    public function execute(): Page
    {
        $page = $this->pages->create();
        if ($this->request->getParam('variant') === 'selected') {
            $page->getLayout()->getUpdate()->addHandle('coverageprobe_layout_dynamic');
        }
        return $page;
    }
}
