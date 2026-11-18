<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\References;

use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\Controller\Result\Raw;
use Magento\Framework\Controller\Result\RawFactory;
use Magento\Framework\View\Result\LayoutFactory;

class Index implements HttpGetActionInterface
{
    public function __construct(private LayoutFactory $layouts, private RawFactory $raw)
    {
    }

    public function execute(): Raw
    {
        $fragment = $this->layouts->create();
        $fragment->addHandle('coverageprobe_references_index');
        $layout = $fragment->getLayout();
        $subject = $layout->getBlock('magelens.reference.subject');
        if (!$subject || $subject->getData('marker') !== 'reference-marker'
            || $subject->getData('action_marker') !== 'action-marker'
            || $layout->getBlock('magelens.reference.missing') !== false
            || !$layout->getBlock('magelens.reference.hidden')
            || $layout->getBlock('magelens.reference.unrendered')->getTemplate() !== 'MageLens_Compatibility::layout-reference-effective.phtml'
            || $layout->hasElement('magelens.reference.removed')
            || $layout->getBlock('magelens.reference.removed.child') !== false
            || $layout->hasElement('magelens.reference.absent.parent')
            || $layout->getParentName('magelens.reference.attached') !== 'magelens.reference.inner') {
            throw new \RuntimeException('Native reference structure, arguments or action changed');
        }
        $output = $layout->getOutput();
        if (!str_contains($output, 'reference-marker/action-marker') || str_contains($output, 'base-template')
            || str_contains($output, 'layout-reference-removed') || str_contains($output, 'layout-reference-empty')
            || !str_contains($output, 'attached-child') || str_contains($output, 'detached-child')) {
            throw new \RuntimeException('Native reference output changed');
        }
        return $this->raw->create()->setContents($output . '<span data-layout-reference-proof>verified</span>');
    }
}
