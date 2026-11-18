<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Cache;

use MageLens\Compatibility\Model\LayoutCacheCounter;
use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\App\Cache\StateInterface;
use Magento\Framework\App\CacheInterface;
use Magento\Framework\App\ViewInterface;
use Magento\Framework\Controller\Result\Raw;
use Magento\Framework\Controller\Result\RawFactory;
use Magento\Framework\View\Result\PageFactory;

class Index implements HttpGetActionInterface
{
    public bool $replaceCachedHtml = false;

    public function __construct(
        private PageFactory $pages,
        private RawFactory $raw,
        private StateInterface $state,
        private CacheInterface $cache,
        ViewInterface $view
    ) {
    }

    public function execute(): Raw
    {
        $previous = $this->state->isEnabled('block_html');
        $this->state->setEnabled('block_html', true);
        LayoutCacheCounter::$renders = 0;
        $nonce = 'magelens_layout_' . bin2hex(random_bytes(12));
        $key = null;
        $output = '';
        try {
            foreach (['cold', 'warm'] as $case) {
                $page = $this->pages->create(true, ['isIsolated' => true]);
                $page->addHandle('coverageprobe_cache_' . $case);
                $block = $page->getLayout()->getBlock('magelens.layout.cache.' . $case);
                $block->setData('cache_key', $nonce);
                $key = $block->getCacheKey();
                $html = $block->toHtml();
                if (LayoutCacheCounter::$renders !== 1 || !str_contains($html, 'data-layout-block-cache>cold-value</span>')) {
                    throw new \RuntimeException('Native block HTML cache did not preserve the cold render');
                }
                if ($case === 'cold' && $this->replaceCachedHtml) {
                    $sameBytes = $this->cache->load($key);
                    if (!is_string($sameBytes)) throw new \RuntimeException('Native cache replacement data is absent');
                    if (!$this->cache->save($sameBytes, $key, ['block_html'], 600)) throw new \RuntimeException('Native cache replacement failed');
                    if ($this->cache->load($key) !== $sameBytes) throw new \RuntimeException('Native cache replacement bytes changed');
                }
                $output .= $html;
            }
        } finally {
            if ($key !== null) $this->cache->remove($key);
            $this->state->setEnabled('block_html', $previous);
        }
        return $this->raw->create()->setContents($output);
    }
}
