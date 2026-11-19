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
        $variant = $this->request->getParam('variant');
        $handles = match ($variant) {
            'page-values' => ['coverageprobe_page_values_base', 'coverageprobe_page_values_falsy'],
            'page-metadata' => ['coverageprobe_page_metadata'],
            'controller-asset' => ['coverageprobe_page_controller_asset'],
            default => [],
        };
        if ($handles) {
            $page = $this->pages->create(true, ['isIsolated' => true]);
            $page->addHandle('default');
            foreach ($handles as $handle) $page->addHandle($handle);
            return $page;
        }
        $page = $this->pages->create();
        if ($variant === 'selected') {
            $page->getLayout()->getUpdate()->addHandle('coverageprobe_layout_dynamic');
        }
        return $page;
    }
}
