<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutPackageReplacement
{
    public static int $calls = 0;

    public function aroundGetFileLayoutUpdatesXml(\Magento\Framework\View\Model\Layout\Merge $merge, \Closure $proceed)
    {
        self::$calls++;
        return simplexml_load_string(<<<'XML'
<layouts xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <handle id="coverageprobe_packagemutation_native">
        <body>
            <block class="Magento\Framework\View\Element\Template" name="magelens.layout.package.native" template="MageLens_Compatibility::layout-mutation.phtml">
                <arguments>
                    <argument name="value" xsi:type="string">xml-value</argument>
                    <argument name="late" xsi:type="string">xml-value</argument>
                </arguments>
            </block>
        </body>
    </handle>
</layouts>
XML, \Magento\Framework\View\Layout\Element::class);
    }
}
