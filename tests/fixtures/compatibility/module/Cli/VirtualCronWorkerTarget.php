<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

namespace MageLens\Compatibility\Cli;

class VirtualCronWorkerTarget extends CronWorker
{
    protected const MESSAGE = 'virtual-worker';
}
