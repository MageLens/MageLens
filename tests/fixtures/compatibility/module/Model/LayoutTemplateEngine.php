<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutTemplateEngine extends \Magento\Framework\View\TemplateEngine\Php
{
    public function render(\Magento\Framework\View\Element\BlockInterface $block, $fileName, array $dictionary = [])
    {
        return parent::render($block, BP . '/app/code/MageLens/Compatibility/view/frontend/templates/layout-mutation.phtml', $dictionary);
    }
}
