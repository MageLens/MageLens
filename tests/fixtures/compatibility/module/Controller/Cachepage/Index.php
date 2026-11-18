<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Cachepage;

use MageLens\Compatibility\Model\LayoutPageCache;
use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\App\RequestInterface;
use Magento\Framework\Controller\Result\Raw;
use Magento\Framework\Controller\Result\RawFactory;
use Magento\Framework\View\Result\LayoutFactory;

class Index implements HttpGetActionInterface
{
    public function __construct(private LayoutFactory $layouts, private RawFactory $raw, private RequestInterface $request)
    {
    }

    public function execute(): Raw
    {
        $nonce = LayoutPageCache::nonce($this->request);
        $fragment = $this->layouts->create(['isIsolated' => true]);
        $fragment->addHandle('coverageprobe_cachepage_index');
        return $this->raw->create()->setContents($fragment->getLayout()->getOutput())
            ->setHeader('Content-Type', 'text/html; charset=UTF-8', true)
            ->setHeader('Cache-Control', 'public, max-age=0, s-maxage=120', true)
            ->setHeader('X-Magento-Tags', 'MAGELENS_LAYOUT_FPC,MAGELENS_LAYOUT_FPC_' . $nonce, true);
    }
}
