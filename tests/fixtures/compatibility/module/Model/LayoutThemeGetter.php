<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutThemeGetter
{
    public static int $collectorCalls = 0;

    public function afterGetTheme(\Magento\Framework\View\Model\Layout\Merge $merge, $result)
    {
        foreach (debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 32) as $frame) {
            if (($frame['class'] ?? '') === 'MageLens\\XmlCoverage\\LayoutCoverage') {
                self::$collectorCalls++;
                break;
            }
        }
        $replacement = clone $result;
        $replacement->setData('theme_path', 'MageLens/inactive');
        return $replacement;
    }
}
