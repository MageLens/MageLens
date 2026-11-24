<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Mutation;

use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\App\ViewInterface;
use Magento\Framework\Controller\Result\Raw;
use Magento\Framework\Controller\Result\RawFactory;
use Magento\Framework\View\Result\PageFactory;

class Index implements HttpGetActionInterface
{
    public function __construct(private PageFactory $pages, private RawFactory $raw, ViewInterface $view)
    {
    }

    public function execute(): Raw
    {
        $output = '';
        foreach (['native', 'direct', 'clone', 'replace'] as $case) {
            $page = $this->pages->create(true, ['isIsolated' => true]);
            $page->addHandle('coverageprobe_mutation_' . $case);
            $output .= $page->getLayout()->getBlock('magelens.layout.mutation.' . $case)->toHtml();
        }
        return $this->raw->create()->setContents($output);
    }
}
