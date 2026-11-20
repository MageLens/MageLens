<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutMergePlugin
{
    public static int $documents = 0;

    public function afterAsSimplexml(\Magento\Framework\View\Model\Layout\Merge $merge, $xml)
    {
        self::$documents++;
        foreach ($xml->xpath('//block[@name="magelens.layout.package.native"]') as $element) {
            $node = dom_import_simplexml($element);
            $node->parentNode->replaceChild($node->cloneNode(true), $node);
        }
        return $xml;
    }
}
