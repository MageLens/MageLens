<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutGeneratorReturn
{
    public static int $calls = 0;

    public function aroundCreateBlock($subject, callable $proceed, $block, $name, array $arguments = [])
    {
        self::$calls++;
        return \Magento\Framework\App\ObjectManager::getInstance()
            ->create(\Magento\Framework\View\Element\Template::class, $arguments)->setNameInLayout($name);
    }
}
