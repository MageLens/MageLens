<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Propertyownership;

use MageLens\Compatibility\Block;
use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\Controller\Result\Raw;
use Magento\Framework\Controller\Result\RawFactory;
use Magento\Framework\View\Result\LayoutFactory;

class Index implements HttpGetActionInterface
{
    public static array $reads = [];

    public function __construct(private LayoutFactory $layouts, private RawFactory $raw)
    {
    }

    public function execute(): Raw
    {
        $output = '';
        $instances = new \SplObjectStorage();
        foreach (['native', 'template-get', 'template-set', 'template-magic', 'template-redeclared',
            'data-get', 'data-magic', 'data-redeclared', 'data-set', 'data-direct', 'after-failure'] as $case) {
            $fragment = $this->layouts->create();
            $layout = $fragment->getLayout();
            if ($instances->contains($layout)) throw new \LogicException('Property fixtures require independent native layout instances');
            $instances->attach($layout);
            $target = $case === 'after-failure' ? 'native' : $case;
            $fragment->addHandle('coverageprobe_propertyownership_' . str_replace('-', '_', $target));
            try {
                $block = $fragment->getLayout()->getBlock('magelens.layout.property.' . $target);
                if ($case === 'data-set') {
                    throw new \LogicException('Expected native indirect property modification failure');
                }
            } catch (\Error $error) {
                if ($case !== 'data-set' || $error->getMessage() !== 'Indirect modification of '
                    . Block\LayoutDataPropertySet::class . '::$_data is not allowed'
                    || Block\LayoutDataPropertySet::$writes < 1) {
                    throw new \LogicException('Unexpected property failure in ' . $case . '; setter calls: '
                        . Block\LayoutDataPropertySet::$writes, previous: $error);
                }
                $output .= '<span data-layout-property="' . $case . '">verified</span>';
                continue;
            }
            if ($block->getData('ttl') !== 47) throw new \RuntimeException('Native property TTL assignment changed');
            if ($case === 'template-get') Block\LayoutTemplatePropertyGet::$reads = 0;
            if ($case === 'template-magic') Block\LayoutTemplatePropertyMagic::$reads = 0;
            if ($case === 'data-get') Block\LayoutDataPropertyGet::$reads = 0;
            if ($case === 'data-magic') Block\LayoutDataPropertyMagic::$reads = 0;
            if (!str_contains($block->toHtml(), 'data-layout-property-value>verified</span>')) {
                throw new \RuntimeException('Native property storage changed the fixture output');
            }
            if ($case === 'data-direct' && Block\LayoutDataDirect::$writes !== 1) throw new \RuntimeException('Native direct data writes were bypassed');
            $reads = match ($case) {
                'template-get' => Block\LayoutTemplatePropertyGet::$reads,
                'template-magic' => Block\LayoutTemplatePropertyMagic::$reads,
                'data-get' => Block\LayoutDataPropertyGet::$reads,
                'data-magic' => Block\LayoutDataPropertyMagic::$reads,
                default => null,
            };
            if ($reads !== null) {
                if ($reads < 1) throw new \RuntimeException('Native property read hook was bypassed');
                self::$reads[$case] = $reads;
            }
            $writes = match ($case) {
                'template-set' => Block\LayoutTemplatePropertySet::$writes,
                'template-magic' => Block\LayoutTemplatePropertyMagic::$writes,
                'data-set' => Block\LayoutDataPropertySet::$writes,
                default => null,
            };
            if ($writes !== null && $writes < 1) throw new \RuntimeException('Native property write hook was bypassed');
            $output .= '<span data-layout-property="' . $case . '">verified</span>';
        }
        return $this->raw->create()->setContents($output);
    }
}
