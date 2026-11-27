<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace Application\Blog\Model;

class JournalFailingImplementation
{
    public function __construct()
    {
        throw new \DomainException('fixture constructor');
    }
}
