<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

namespace MageLens\Compatibility\Plugin;

use MageLens\Compatibility\Cli\PreferredCronWorker;
use Magento\Cron\Model\Schedule;

class CronWorkerMessage
{
    public function afterExecute(PreferredCronWorker $subject, mixed $result, Schedule $schedule): void
    {
        $schedule->setMessages($schedule->getMessages() . '-intercepted');
    }
}
