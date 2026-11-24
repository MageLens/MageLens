<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutTemplateBefore extends \Magento\ProductAlert\Model\UpdateThemeParams
{
    public static int $calls = 0;

    public function beforeGetTemplateFileName(
        \Magento\Framework\View\Element\Template\File\Resolver $subject,
        string|null $template,
        array $params = []
    ): array {
        self::$calls++;
        return ['MageLens_Compatibility::layout-mutation.phtml', $params];
    }
}
