<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutReaderReplacement implements \Magento\Framework\View\Layout\ReaderInterface
{
    public function __construct(private \Magento\Framework\View\Layout\ReaderInterface $original)
    {
    }

    public function getSupportedNodes()
    {
        return $this->original->getSupportedNodes();
    }

    public function interpret(
        \Magento\Framework\View\Layout\Reader\Context $context,
        \Magento\Framework\View\Layout\Element $element
    ) {
        if (isset($element->visibilityCondition[0])) {
            $node = dom_import_simplexml($element->visibilityCondition[0]);
            $node->parentNode->replaceChild($node->cloneNode(true), $node);
        }
        return $this->original->interpret($context, $element);
    }
}
