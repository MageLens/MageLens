<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutFailedActionOptions implements \Magento\Framework\Data\OptionSourceInterface
{
    public static int $calls = 0;
    public function toOptionArray(): array { self::$calls++; return ['fixture-option' => 'Fixture label']; }
}
