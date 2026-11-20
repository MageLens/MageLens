<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutThemeContext extends \Magento\Theme\Model\Theme
{
    public static int $collectorCalls = 0;

    private function observeCaller(): void
    {
        foreach (debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 32) as $frame) {
            if (str_starts_with($frame['class'] ?? '', 'MageLens\\XmlCoverage\\')) {
                self::$collectorCalls++;
                break;
            }
        }
    }

    public function getArea()
    {
        $this->observeCaller();
        return parent::getArea();
    }

    public function getFullPath()
    {
        $this->observeCaller();
        return parent::getFullPath();
    }
}
