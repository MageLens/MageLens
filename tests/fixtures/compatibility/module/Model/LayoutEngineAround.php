<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutEngineAround
{
    public static int $calls = 0;

    public function aroundRender($subject, callable $proceed, $block, $fileName, array $dictionary = [])
    {
        self::$calls++;
        return '<span data-layout-mutation>xml-value</span>';
    }
}
