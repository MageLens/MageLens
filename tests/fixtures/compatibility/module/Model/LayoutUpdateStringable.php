<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutUpdateStringable implements \Stringable
{
    public static int $calls = 0;
    public static int $collectorCalls = 0;

    public function __toString(): string
    {
        self::$calls++;
        foreach (debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 32) as $frame) {
            if (str_starts_with($frame['class'] ?? '', 'MageLens\\XmlCoverage\\')) {
                self::$collectorCalls++;
                break;
            }
        }
        return <<<'XML'
<body>
    <referenceBlock name="magelens.layout.package.native" template="MageLens_Compatibility::layout-mutation.phtml">
        <arguments><argument name="value" xsi:type="string">xml-value</argument></arguments>
    </referenceBlock>
</body>
XML;
    }
}
