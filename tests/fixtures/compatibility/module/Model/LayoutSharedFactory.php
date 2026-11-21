<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

use MageLens\Compatibility\Block\LayoutShared;

class LayoutSharedFactory extends \Magento\Framework\View\Element\BlockFactory
{
    private ?LayoutShared $shared = null;

    public function createBlock($blockName, array $arguments = [])
    {
        if ($blockName !== LayoutShared::class) return parent::createBlock($blockName, $arguments);
        return $this->shared ??= parent::createBlock($blockName, $arguments);
    }
}
