<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutTemplateResolverPlugin
{
    public static int $calls = 0;

    public function afterGetTemplateFileName($subject, $result)
    {
        self::$calls++;
        return BP . '/app/code/MageLens/Compatibility/view/frontend/templates/layout-mutation.phtml';
    }
}
