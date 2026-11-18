<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutObjectManager implements \Magento\Framework\ObjectManagerInterface
{
    public static int $calls = 0;

    public function __construct(private \Magento\Framework\ObjectManagerInterface $delegate)
    {
    }

    public function create($type, array $arguments = [])
    {
        self::$calls++;
        return $this->delegate->create(\Magento\Framework\View\Element\Template::class, $arguments);
    }

    public function get($type)
    {
        return $this->delegate->get($type);
    }

    public function configure(array $configuration)
    {
        $this->delegate->configure($configuration);
    }
}
