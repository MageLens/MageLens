<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutOpaqueActionParser extends \Magento\Framework\View\Layout\Argument\Parser
{
    public function parse(\DOMNode $node)
    {
        return $node instanceof \DOMElement && $node->parentNode?->nodeName === 'action' && $node->getAttribute('name') === 'value'
            ? new LayoutOpaqueActionValue() : parent::parse($node);
    }
}
