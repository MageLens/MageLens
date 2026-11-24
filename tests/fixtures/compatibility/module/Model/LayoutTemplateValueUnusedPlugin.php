<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutTemplateValueUnusedPlugin
{
    public function afterGetUrl($subject, $result)
    {
        throw new \RuntimeException('The template-value fixture must not call getUrl');
    }
}
