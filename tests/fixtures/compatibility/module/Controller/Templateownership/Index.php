<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Templateownership;

use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\App\ViewInterface;
use Magento\Framework\Controller\Result\Raw;
use Magento\Framework\Controller\Result\RawFactory;
use Magento\Framework\ObjectManagerInterface;
use Magento\Framework\View\Element\Template;
use Magento\Framework\View\Result\PageFactory;

class Index implements HttpGetActionInterface
{
    public function __construct(
        private PageFactory $pages,
        private RawFactory $raw,
        private ObjectManagerInterface $objects,
        ViewInterface $view
    ) {
    }

    public function execute(): Raw
    {
        $output = '';
        foreach (['native', 'getter', 'file', 'resolver'] as $case) {
            $page = $this->pages->create(true, ['isIsolated' => true]);
            $page->addHandle('coverageprobe_templateownership_' . $case);
            $block = $page->getLayout()->getBlock('magelens.layout.template.' . $case);
            if ($case === 'resolver') {
                (new \ReflectionProperty(Template::class, 'resolver'))->setValue($block,
                    $this->objects->create(\MageLens\Compatibility\Model\LayoutTemplateResolver::class));
            }
            $html = $block->toHtml();
            if (!str_contains($html, 'data-layout-mutation>xml-value</span>')) {
                throw new \RuntimeException('Native template replacement changed the fixture output');
            }
            $output .= $html;
        }
        return $this->raw->create()->setContents($output);
    }
}
