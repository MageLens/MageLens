<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutVisibilityDuck
{
    public function getName()
    {
        return 'fixture_visibility';
    }

    public function isVisible(array $arguments)
    {
        return (new LayoutVisibility())->isVisible($arguments);
    }
}
