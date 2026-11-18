<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Dependencies;

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
        foreach (['native', 'resolver_hook', 'context_hook', 'engine_hook', 'resolver_magic',
            'context_magic', 'engine_magic', 'resolver_redeclared', 'lock_magic', 'lock_shadow'] as $case) {
            $fragment = $this->layouts->create();
            $layout = $fragment->getLayout();
            if ($instances->contains($layout)) throw new \LogicException('Dependency fixtures require independent native layouts');
            $instances->attach($layout);
            $fragment->addHandle('coverageprobe_dependencies_' . $case);
            $block = $layout->getBlock('magelens.layout.dependency.' . $case);
            $class = get_class($block);
            $counted = !in_array($case, ['native', 'resolver_redeclared'], true);
            if ($counted) $class::$reads = 0;
            if (!str_contains($block->toHtml(), 'data-layout-dependency-value>verified</span>')) {
                throw new \RuntimeException('Native dependency rendering changed');
            }
            if ($counted) self::$reads[$case] = $class::$reads;
            $output .= '<span data-layout-dependency="' . $case . '">verified</span>';
        }
        return $this->raw->create()->setContents($output);
    }
}
