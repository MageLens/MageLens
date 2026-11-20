<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Sharedactions;

use MageLens\Compatibility\Block\LayoutShared;
use MageLens\Compatibility\Model\LayoutSharedFactory;
use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\App\RequestInterface;
use Magento\Framework\Controller\Result\Raw;
use Magento\Framework\Controller\Result\RawFactory;
use Magento\Framework\ObjectManagerInterface;
use Magento\Framework\View\Layout;
use Magento\Framework\View\Layout\Generator\Block as BlockGenerator;
use Magento\Framework\View\Result\LayoutFactory;

class Index implements HttpGetActionInterface
{
    public function __construct(private LayoutFactory $layouts, private RawFactory $raw, private ObjectManagerInterface $objects) {}
    public function execute(): Raw
    {
        $request = $this->objects->get(RequestInterface::class);
        $case = in_array($request->getParam('case'), ['unguarded', 'distinct'], true) ? $request->getParam('case') : 'guarded';
        $factory = new class($this->objects) extends LayoutSharedFactory {
            public int $creations = 0;
            public function createBlock($type, array $arguments = [])
            {
                $block = parent::createBlock($type, $arguments);
                if ($type === LayoutShared::class) {
                    $this->creations++;
                    // Detach the provider's retained layout before Magento
                    // assigns the new alias through its native name setter.
                    (new \ReflectionProperty(\Magento\Framework\View\Element\AbstractBlock::class, '_layout'))->setRawValue($block, null);
                }
                return $block;
            }
        };
        $fragment = $this->layouts->create();
        $fragment->addHandle('coverageprobe_sharedactions' . ($case === 'guarded' ? '' : '_' . $case));
        $layout = $fragment->getLayout();
        $pool = (new \ReflectionProperty(Layout::class, 'generatorPool'))->getRawValue($layout);
        $generator = $pool->getGenerator('block');
        $property = new \ReflectionProperty(BlockGenerator::class, 'blockFactory');
        $original = $property->getRawValue($generator);
        $property->setRawValue($generator, $factory);
        try {
            $allowed = $layout->getBlock('magelens.shared.action.' . ($case === 'guarded' ? 'allowed' : 'first'));
            $denied = $layout->getBlock('magelens.shared.action.' . ($case === 'guarded' ? 'denied' : 'second'));
            $calls = \MageLens\Compatibility\Test\SharedActionCounter::$calls;
            if (!$allowed || $allowed !== $denied || $allowed->getData('shared_action_proof') !== ($case === 'distinct' ? 'last' : 'applied')
                || $factory->creations < 2 || $factory->creations % 2 !== 0
                || $calls !== ($case === 'guarded' ? intdiv($factory->creations, 2) : $factory->creations)) {
                throw new \RuntimeException('Native shared action target or guard execution changed: ' . json_encode([
                    'blocks' => (bool) $allowed && (bool) $denied, 'same' => $allowed === $denied,
                    'marker' => $allowed && $allowed->getData('shared_action_proof') === ($case === 'distinct' ? 'last' : 'applied'),
                    'creations' => $factory->creations, 'calls' => $calls,
                ]));
            }
            $html = $layout->getOutput();
        } finally { $property->setRawValue($generator, $original); }
        return $this->raw->create()->setContents($html . '<span data-layout-shared-action-proof data-layout-shared-action-case="' . $case . '">verified</span>');
    }
}
