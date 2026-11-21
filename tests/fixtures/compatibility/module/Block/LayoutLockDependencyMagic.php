<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Block;

class LayoutLockDependencyMagic extends LayoutDependencyMagic
{
    protected const FIELD = 'lockQuery';
}
