<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);

namespace MageLens\Compatibility\Cli;

use Magento\Cron\Model\Schedule;
use Magento\Framework\App\Config\ScopeConfigInterface;

class Jobs
{
    public function __construct(
        private readonly ScopeConfigInterface $config,
        private readonly string $expected = '0'
    ) {
    }

    public function run(Schedule $schedule): void
    {
        if ($schedule->getJobCode() !== 'magelens_probe') {
            throw new \RuntimeException('Unexpected cron job');
        }
        if ($this->config->getValue('magelens_probe/cron/enabled') !== $this->expected) {
            throw new \RuntimeException('The cron probe is disabled');
        }
    }

    public function runNamed(Schedule $schedule): void
    {
        $schedule->setMessages($this->config->getValue('magelens_probe/cron/magerun_message'));
    }

    public function runGenerated(Schedule $schedule): void
    {
        $schedule->setMessages('generated-handler-ran');
    }

    public function fail(Schedule $schedule): void
    {
        throw new \RuntimeException('Cron probe handler failed intentionally');
    }

    public function consume(string $token): void
    {
        if (file_put_contents(self::marker($token), $token) === false) {
            throw new \RuntimeException('Cannot record the processed message');
        }
    }

    public static function marker(string $token): string
    {
        if (!preg_match('/^[a-f0-9]{24}$/D', $token)) {
            throw new \InvalidArgumentException('Invalid queue token');
        }
        return BP . '/var/magelens-queue-' . $token;
    }
}
