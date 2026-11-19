<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Templatevalues;

use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\Controller\Result\Raw;
use Magento\Framework\Controller\Result\RawFactory;
use Magento\Framework\View\Result\LayoutFactory;

class Index implements HttpGetActionInterface
{
    public function __construct(private LayoutFactory $layouts, private RawFactory $raw) {}
    public function execute(): Raw
    {
        $fragment = $this->layouts->create();
        $fragment->addHandle('coverageprobe_templatevalues');
        $layout = $fragment->getLayout();
        foreach (['argument', 'action', 'equal.action', 'equal.argument', 'late.argument', 'late.action', 'never', 'empty', 'zero', 'empty.action', 'zero.action', 'default', 'case', 'interceptor'] as $case) {
            $block = $layout->getBlock('magelens.template.values.' . $case);
            $expected = match ($case) { 'empty', 'empty.action' => '', 'zero', 'zero.action' => '0', default => 'MageLens_Compatibility::layout-template-value.phtml' };
            if (!$block || $block->getTemplate() !== $expected) throw new \RuntimeException('Native template value selection changed: ' . $case);
            if (str_starts_with($case, 'late.')) $block->setTemplate('MageLens_Compatibility::layout-template-value.phtml');
        }
        $html = $layout->getOutput();
        if (substr_count($html, 'data-layout-template-value=') !== 9 || str_contains($html, 'magelens.template.values.never')) {
            throw new \RuntimeException('Native template value output changed');
        }
        return $this->raw->create()->setContents($html . '<span data-layout-template-value-proof>verified</span>');
    }
}
