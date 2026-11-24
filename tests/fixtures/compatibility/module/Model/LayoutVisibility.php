<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

use Magento\Framework\View\Layout\Condition\VisibilityConditionInterface;

class LayoutVisibility implements VisibilityConditionInterface
{
    public static array $decisions = [];

    public function getName()
    {
        return 'fixture_visibility';
    }

    public function isVisible(array $arguments)
    {
        $visible = ($arguments['visible'] ?? null) === true
            && ($arguments['nested']['token'] ?? null) === 'ui-condition';
        self::$decisions[] = $visible;
        return $visible;
    }
}
