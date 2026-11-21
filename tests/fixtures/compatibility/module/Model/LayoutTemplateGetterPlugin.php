<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutTemplateGetterPlugin
{
    public static int $calls = 0;

    public function afterGetTemplate($subject, $result)
    {
        self::$calls++;
        return 'MageLens_Compatibility::layout-mutation.phtml';
    }
}
