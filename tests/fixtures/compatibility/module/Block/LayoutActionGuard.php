<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Block;

class LayoutActionGuard extends \Magento\Framework\View\Element\AbstractBlock
{
    private array $markers = [];
    public function mark(string $marker): void
    {
        $this->markers[] = $marker;
    }
    public function markers(): array
    {
        return $this->markers;
    }
    protected function _toHtml()
    {
        return '<span data-layout-action-case="' . $this->escapeHtmlAttr($this->getNameInLayout())
            . '">' . $this->escapeHtml(implode(',', $this->markers)) . '</span>';
    }
}
