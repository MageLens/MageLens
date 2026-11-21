<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Boundary;

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
        foreach (['failed', 'success'] as $case) {
            $page = $this->pages->create(true, ['isIsolated' => true]);
            $page->addHandle('coverageprobe_boundary_' . $case);
            try {
                $block = $page->getLayout()->getBlock('magelens.layout.boundary.same');
                $output .= $block->toHtml();
                if ($case === 'failed') throw new \LogicException('Expected fixture rendering failure');
            } catch (\RuntimeException $error) {
                if ($case !== 'failed' || $error->getMessage() !== 'MageLens fixture template failed after reading its value') throw $error;
                $output .= '<span data-layout-boundary-failure>verified</span>';
            }
        }
        return $this->raw->create()->setContents($output);
    }
}
