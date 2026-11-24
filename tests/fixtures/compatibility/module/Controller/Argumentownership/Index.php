<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Argumentownership;

use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\App\ViewInterface;
use Magento\Framework\Controller\Result\Raw;
use Magento\Framework\Controller\Result\RawFactory;
use Magento\Framework\Data\Argument\Interpreter\Composite;
use Magento\Framework\ObjectManagerInterface;
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
        $property = new \ReflectionProperty(Composite::class, 'interpreters');
        foreach (['native', 'reader', 'generator'] as $case) {
            $composite = null;
            if ($case !== 'native') {
                $composite = $this->objects->get($case === 'reader'
                    ? 'layoutArgumentReaderInterpreter' : 'layoutArgumentGeneratorInterpreterInternal');
                $original = $property->getValue($composite);
                $replacement = $original;
                $replacement[$case === 'reader' ? 'string' : 'helper'] = new \MageLens\Compatibility\Model\LayoutValueInterpreter();
                $property->setValue($composite, $replacement);
            }
            try {
                $page = $this->pages->create(true, ['isIsolated' => true]);
                $page->addHandle('coverageprobe_argumentownership_' . $case);
                $block = $page->getLayout()->getBlock('magelens.layout.argument.' . $case);
                if ($block->getData('late') !== 'xml-value' || $block->getData('action_value') !== 'xml-value'
                    || $block->getData('nested') !== ['changed' => 'xml-value', 'surviving' => 'xml-value']) {
                    throw new \RuntimeException('Native argument ownership fixture values changed');
                }
                $output .= $block->toHtml();
            } finally {
                if ($composite !== null) $property->setValue($composite, $original);
            }
        }
        return $this->raw->create()->setContents($output);
    }
}
