<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Actionguards;

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
        $fragment->addHandle('coverageprobe_actionguards');
        $layout = $fragment->getLayout();
        foreach (['allowed' => ['allowed'], 'denied' => [], 'duplicate' => ['first', 'second'],
            'empty' => ['empty'], 'zero' => ['zero'], 'same' => ['same']] as $case => $expected) {
            $block = $layout->getBlock('magelens.action.guard.' . $case);
            if (!$block || $block->markers() !== $expected) throw new \RuntimeException('Native action guard changed: ' . $case);
        }
        if ($layout->getBlock('magelens.action.guard.missing')) throw new \RuntimeException('Missing action target was created');
        return $this->raw->create()->setContents($layout->getOutput() . '<span data-layout-action-guard-proof>verified</span>');
    }
}
