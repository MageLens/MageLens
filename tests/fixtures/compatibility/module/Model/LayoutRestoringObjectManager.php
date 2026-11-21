<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutRestoringObjectManager extends LayoutObjectManager
{
    public function __construct(
        private \Magento\Framework\ObjectManagerInterface $original,
        private \Magento\Framework\View\Element\BlockFactory $factory
    ) {
        parent::__construct($original);
    }

    public function create($type, array $arguments = [])
    {
        $block = parent::create($type, $arguments);
        (new \ReflectionProperty(\Magento\Framework\View\Element\BlockFactory::class, 'objectManager'))->setValue($this->factory, $this->original);
        return $block;
    }
}
