<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Dynamic;

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
        $output = '';
        foreach (['native', 'equal', 'nested', 'scalar'] as $case) {
            $fragment = $this->layouts->create();
            $fragment->addHandle('coverageprobe_dynamic_' . $case);
            $layout = $fragment->getLayout();
            $update = $layout->getUpdate();
            $update->load();
            if ($case !== 'native') {
                $attributes = $case === 'equal'
                    ? ' class="Magento\Framework\View\Element\Template" template="MageLens_Compatibility::layout-dynamic.phtml"' : '';
                $argument = match ($case) {
                    'equal' => '<argument name="value" xsi:type="string">xml-value</argument>',
                    'nested' => '<argument name="nested" xsi:type="array"><item name="changed" xsi:type="string">xml-value</item></argument>',
                    'scalar' => '<argument name="nested" xsi:type="string">xml-value</argument>',
                };
                $update->addUpdate('<referenceBlock xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" name="magelens.layout.dynamic.'
                    . $case . '"' . $attributes . '><arguments>' . $argument . '</arguments></referenceBlock>');
            }
            $block = $layout->getBlock('magelens.layout.dynamic.' . $case);
            $nested = $case === 'scalar' ? 'xml-value' : ['changed' => 'xml-value', 'surviving' => 'xml-value'];
            if ($block->getData('value') !== 'xml-value' || $block->getData('nested') !== $nested) {
                throw new \RuntimeException('Native programmatic layout replacement changed fixture values or surviving children');
            }
            if ($case !== 'scalar' && ($block->getDataByPath('nested/changed') !== 'xml-value'
                || $block->getDataByPath('nested/surviving') !== 'xml-value')) {
                throw new \RuntimeException('Native programmatic layout replacement changed individually read array leaves');
            }
            $output .= $block->toHtml();
        }
        return $this->raw->create()->setContents($output);
    }
}
