<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutDocumentReplacement
{
    public static int $calls = 0;

    public function aroundAsSimplexml(\Magento\Framework\View\Model\Layout\Merge $merge, \Closure $proceed)
    {
        self::$calls++;
        return simplexml_load_string(
            '<layout xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' . $merge->asString() . '</layout>',
            \Magento\Framework\View\Layout\Element::class
        );
    }
}
