<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Block;

class LayoutFailedAction extends \Magento\Framework\View\Element\AbstractBlock
{
    public static array $entered = [];
    public static ?string $onlyCase = null;
    public static bool $applied = false;
    public function applyBeforeFailure(string $marker): void
    {
        self::$entered[] = 'body';
        $this->setData('applied_before_failure', $marker);
        self::$applied = $this->getData('applied_before_failure') === $marker;
        throw new \RuntimeException('Intentional layout action failure');
    }
    public function observe(string $marker): void { self::$entered[] = $marker; }
    public function requireObject(\stdClass $marker): void { self::$entered[] = 'typed'; }
}
