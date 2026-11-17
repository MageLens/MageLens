<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutVisibilityMagic
{
    public function __call(string $name, array $arguments)
    {
        if ($name === 'getName') return 'fixture_visibility';
        if ($name === 'isVisible') return (new LayoutVisibility())->isVisible($arguments[0]);
        throw new \LogicException('Unexpected fixture visibility method');
    }
}
