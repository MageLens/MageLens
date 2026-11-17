<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace Application\Blog\Plugin;

use Application\Blog\Model\JournalPluginSubject;

class JournalBefore
{
    public function beforeProbe(JournalPluginSubject $subject, string $value): array
    {
        return [$value . 'b'];
    }
}
