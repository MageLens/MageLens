<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\ObserverOverride;

class ExternalPlugin
{
    public function beforeProbe(\Application\Blog\Model\JournalPluginSubject $subject, string $value): array
    {
        return [$value . 'x'];
    }
}
