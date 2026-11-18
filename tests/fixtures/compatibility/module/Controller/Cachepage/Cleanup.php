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
use Magento\PageCache\Model\Cache\Type;

class Cleanup implements HttpGetActionInterface
{
    public function __construct(private Type $cache, private RawFactory $raw, private RequestInterface $request)
    {
    }

    public function execute(): Raw
    {
        $this->cache->clean(\Zend_Cache::CLEANING_MODE_MATCHING_TAG, ['MAGELENS_LAYOUT_FPC_' . LayoutPageCache::nonce($this->request)]);
        return $this->raw->create()->setContents('<span data-layout-page-cache-cleanup>cleaned</span>');
    }
}
