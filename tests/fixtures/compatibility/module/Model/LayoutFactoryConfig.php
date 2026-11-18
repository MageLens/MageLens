<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutFactoryConfig extends \Magento\Framework\ObjectManager\Config\Config
{
    private \Magento\Framework\View\Element\BlockFactory $factory;
    private \Magento\Framework\ObjectManagerInterface $objects;

    public function initialize(\Magento\Framework\View\Element\BlockFactory $factory, \Magento\Framework\ObjectManagerInterface $objects): void
    {
        $this->factory = $factory;
        $this->objects = $objects;
    }

    public function getInstanceType($instanceName)
    {
        $replacement = new LayoutRestoringObjectManager($this->objects, $this->factory);
        (new \ReflectionProperty(\Magento\Framework\View\Element\BlockFactory::class, 'objectManager'))->setValue($this->factory, $replacement);
        return \Magento\Framework\View\Element\Template::class;
    }
}
