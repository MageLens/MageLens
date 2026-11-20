<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Block;

class RenderAfterFailure extends \Magento\Framework\View\Element\Template
{
    protected function _afterToHtml($html)
    {
        if ($this->getData('engine_completed') !== true) {
            throw new \LogicException('Expected successful template execution before the post-render failure');
        }
        throw new \RuntimeException('Intentional failure after successful template execution');
    }
}
