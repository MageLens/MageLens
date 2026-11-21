<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Shared;

use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\Controller\Result\Raw;
use Magento\Framework\Controller\Result\RawFactory;
use Magento\Framework\ObjectManagerInterface;
use Magento\Framework\View\Layout;
use Magento\Framework\View\Layout\Generator\Block as BlockGenerator;
use Magento\Framework\View\Result\LayoutFactory;
use MageLens\Compatibility\Model\LayoutSharedFactory;

class Index implements HttpGetActionInterface
{
    public function __construct(private LayoutFactory $layouts, private RawFactory $raw, private ObjectManagerInterface $objects)
    {
    }

    public function execute(): Raw
    {
        $factory = $this->objects->create(LayoutSharedFactory::class);
        $blocks = [];
        $nativeLayouts = [];
        foreach (['first', 'second'] as $case) {
            $fragment = $this->layouts->create();
            $fragment->addHandle('coverageprobe_shared_' . $case);
            $layout = $fragment->getLayout();
            $nativeLayouts[] = $layout;
            $pool = (new \ReflectionProperty(Layout::class, 'generatorPool'))->getValue($layout);
            $generator = $pool->getGenerator('block');
            $property = new \ReflectionProperty(BlockGenerator::class, 'blockFactory');
            $original = $property->getValue($generator);
            $property->setValue($generator, $factory);
            try {
                $blocks[] = $layout->getBlock('magelens.layout.shared');
            } finally {
                $property->setValue($generator, $original);
            }
        }
        $structure = new \ReflectionProperty(Layout::class, 'structure');
        if ($nativeLayouts[0] === $nativeLayouts[1]
            || $structure->getValue($nativeLayouts[0]) === $structure->getValue($nativeLayouts[1])) {
            throw new \RuntimeException('Native fixture did not construct distinct layouts and structures');
        }
        if ($blocks[0] !== $blocks[1] || $blocks[0]->getData('value') !== 'second-value') {
            throw new \RuntimeException('Native fixture did not reuse the block and apply the second layout values');
        }
        $native = $nativeLayouts[0]->renderElement('magelens.layout.shared')
            . $nativeLayouts[1]->renderElement('magelens.layout.shared');
        $direct = $blocks[0]->toHtml() . $blocks[1]->toHtml();
        return $this->raw->create()->setContents('<div data-layout-shared-path="native">' . $native . '</div>'
            . '<div data-layout-shared-path="direct">' . $direct . '</div>');
    }
}
