<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Block;

class LayoutMagicAction extends \Magento\Framework\View\Element\AbstractBlock
{
    private array $markers = [];
    public function __call($method, $arguments)
    {
        if ($method === '' || $method === '0') {
            if (count($arguments) !== 1 || $arguments[0] !== 'fixture') throw new \RuntimeException('Native magic action arguments changed');
            $this->markers[] = $method === '' ? 'empty' : 'zero';
            return $this;
        }
        return parent::__call($method, $arguments);
    }
    public function markers(): array { return $this->markers; }
    protected function _toHtml()
    {
        return '<span data-layout-magic-action="' . $this->escapeHtmlAttr($this->getNameInLayout())
            . '">' . $this->escapeHtml(implode(',', $this->markers)) . '</span>';
    }
}
