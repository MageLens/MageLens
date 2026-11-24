<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

namespace MageLens\Compatibility\Plugin;

use MageLens\Compatibility\Cli\Jobs;
use Magento\Cron\Model\Schedule;

final class CronInterceptor
{
    public function aroundRunIntercepted(Jobs $subject, callable $proceed, Schedule $schedule): void
    {
        $schedule->setData('magelens_calls', 0);
        if ($schedule->getJobCode() === 'magelens_cron_proceeded') {
            $proceed($schedule);
        }
        $schedule->setMessages((string) $schedule->getData('magelens_calls'));
    }
}
