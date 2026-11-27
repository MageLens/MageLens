<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace Application\Blog\Plugin;

use Application\Blog\Model\JournalPluginSubject;

class JournalWarm
{
    public function afterWarm(JournalPluginSubject $subject, string $result): string
    {
        return $result === 'warm-target' ? 'warm-plugin' : $result;
    }

    public function beforeUnused(JournalPluginSubject $subject): void {}
}
