<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace Application\Blog\Model;

class JournalPluginSubject implements JournalPluginSubjectInterface
{
    public function probe(string $value): string { return 'original:' . $value; }
    public function warm(): string { return 'warm-target'; }
    public function unused(): void {}
}
