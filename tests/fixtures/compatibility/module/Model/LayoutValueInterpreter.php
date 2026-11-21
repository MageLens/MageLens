<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutValueInterpreter implements \Magento\Framework\Data\Argument\InterpreterInterface
{
    public static int $calls = 0;

    public function evaluate(array $data)
    {
        self::$calls++;
        return 'xml-value';
    }

    public function value(): string
    {
        return 'xml-value';
    }
}
