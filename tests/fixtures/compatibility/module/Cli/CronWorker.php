<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

namespace MageLens\Compatibility\Cli;

use Magento\Cron\Model\Schedule;

class CronWorker
{
    protected const MESSAGE = 'base-worker';

    public function execute(Schedule $schedule): void
    {
        $schedule->setMessages(static::MESSAGE);
    }
}
