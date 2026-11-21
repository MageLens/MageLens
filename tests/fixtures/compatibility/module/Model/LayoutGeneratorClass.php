<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutGeneratorClass
{
    public static int $calls = 0;

    public function beforeCreateBlock($subject, $block, $name, array $arguments = []): array
    {
        self::$calls++;
        return [\Magento\Framework\View\Element\Template::class, $name, $arguments];
    }
}
