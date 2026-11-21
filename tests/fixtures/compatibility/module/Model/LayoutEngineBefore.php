<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutEngineBefore
{
    public static int $calls = 0;

    public function beforeRender($subject, $block, $fileName, array $dictionary = [])
    {
        self::$calls++;
        return [$block, BP . '/app/code/MageLens/Compatibility/view/frontend/templates/layout-mutation.phtml', $dictionary];
    }
}
