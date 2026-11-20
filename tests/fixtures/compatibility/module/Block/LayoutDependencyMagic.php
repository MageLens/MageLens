<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Block;

abstract class LayoutDependencyMagic extends \Magento\Framework\View\Element\Template
{
    protected const FIELD = '';
    public static int $reads = 0;
    private $replacement;

    protected function _construct()
    {
        parent::_construct();
        $owner = static::FIELD === 'lockQuery' ? \Magento\Framework\View\Element\AbstractBlock::class
            : \Magento\Framework\View\Element\Template::class;
        $this->replacement = (new \ReflectionProperty($owner, static::FIELD))->getRawValue($this);
        if (static::FIELD === 'lockQuery') $this->unsetDependency($owner);
    }

    protected function _beforeToHtml()
    {
        // The native block factory resets templateContext after construction.
        if (static::FIELD !== 'lockQuery') $this->unsetDependency(\Magento\Framework\View\Element\Template::class);
        return parent::_beforeToHtml();
    }

    private function unsetDependency(string $owner): void
    {
        $unset = \Closure::bind(function (string $field): void { unset($this->{$field}); }, $this, $owner);
        $unset(static::FIELD);
    }

    public function __get($key)
    {
        if ($key !== static::FIELD) throw new \LogicException('Unexpected dependency fixture property access');
        static::$reads++;
        return $this->replacement;
    }
}
