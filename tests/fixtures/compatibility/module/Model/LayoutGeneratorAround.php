<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutGeneratorAround
{
    public static int $calls = 0;

    public function aroundCreateBlock($subject, callable $proceed, $block, $name, array $arguments = [])
    {
        self::$calls++;
        return $proceed(\Magento\Framework\View\Element\Template::class, $name, $arguments);
    }
}
