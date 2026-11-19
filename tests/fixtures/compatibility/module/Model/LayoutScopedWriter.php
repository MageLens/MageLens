<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

use Magento\Framework\View\Element\Template;

class LayoutScopedWriter
{
    public static int $writes = 0;

    public static function write(Template $block, string $field, string $method): void
    {
        $write = function () use ($field): void {
            LayoutScopedWriter::$writes++;
            $this->$field = $field === '_template' ? 'MageLens_Compatibility::layout-mutation.phtml'
                : ['value' => 'xml-value', 'late' => 'xml-value'];
        };
        if ($method === 'call') $write->call($block);
        else {
            $bound = $method === 'bind' ? \Closure::bind($write, $block, Template::class)
                : $write->bindTo($block, Template::class);
            $bound();
        }
    }
}
