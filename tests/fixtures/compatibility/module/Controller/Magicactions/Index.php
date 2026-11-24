<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Magicactions;

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
        $fragment->addHandle('coverageprobe_magicactions');
        $layout = $fragment->getLayout();
        foreach (['empty' => ['empty'], 'zero' => ['zero'], 'denied' => [], 'unrendered' => ['empty']] as $case => $expected) {
            $block = $layout->getBlock('magelens.magic.action.' . $case);
            if (!$block || $block->markers() !== $expected) throw new \RuntimeException('Native magic action changed: ' . $case);
        }
        $html = $layout->getOutput();
        if (substr_count($html, 'data-layout-magic-action=') !== 3 || str_contains($html, 'magelens.magic.action.unrendered')) {
            throw new \RuntimeException('Native magic action output membership changed');
        }
        return $this->raw->create()->setContents($html . '<span data-layout-magic-action-proof>verified</span>');
    }
}
