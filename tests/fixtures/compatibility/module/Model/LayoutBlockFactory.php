<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutBlockFactory extends \Magento\Framework\View\Element\BlockFactory
{
    public static int $calls = 0;

    public function createBlock($blockName, array $arguments = [])
    {
        self::$calls++;
        return parent::createBlock(\Magento\Framework\View\Element\Template::class, $arguments);
    }
}
