<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutArgumentParserPlugin
{
    public static int $calls = 0;

    public function aroundParse(
        \Magento\Framework\View\Layout\Argument\Parser $parser,
        \Closure $proceed,
        \DOMNode $node
    ): array {
        self::$calls++;
        return ['name' => 'value', 'xsi:type' => 'string', 'value' => 'xml-value'];
    }
}
