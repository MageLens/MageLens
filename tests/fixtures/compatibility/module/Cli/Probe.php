<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);

namespace MageLens\Compatibility\Cli;

use Magento\Cron\Model\ResourceModel\Schedule as ScheduleResource;
use Magento\Cron\Model\Schedule;
use Magento\Cron\Model\ScheduleFactory;
use Magento\Framework\MessageQueue\PublisherInterface;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\ConsoleOutputInterface;
use Symfony\Component\Console\Output\OutputInterface;

class Probe extends Command
{
    public function __construct(
        private readonly ScheduleFactory $schedules,
        private readonly ScheduleResource $resource,
        private readonly PublisherInterface $publisher
    ) {
        parent::__construct('magelens:probe');
    }

    protected function configure(): void
    {
        $this->addArgument('action', InputArgument::REQUIRED)
            ->addArgument('value', InputArgument::REQUIRED);
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $value = $input->getArgument('value');
        switch ($input->getArgument('action')) {
            case 'echo':
                $output->writeln($value, OutputInterface::OUTPUT_RAW);
                break;
            case 'schedule':
                $now = time();
                $schedule = $this->schedules->create()
                    ->setJobCode('magelens_probe')
                    ->setStatus(Schedule::STATUS_PENDING)
                    ->setCreatedAt(gmdate('Y-m-d H:i:s', $now))
                    ->setScheduledAt(gmdate('Y-m-d H:i:00', $now - 60));
                $this->resource->save($schedule);
                $output->writeln((string) $schedule->getId());
                break;
            case 'status':
                $output->writeln($this->schedule($value)->getStatus());
                break;
            case 'unschedule':
                $this->resource->getConnection()->delete($this->resource->getMainTable(), [
                    'schedule_id = ?' => $value,
                    'job_code = ?' => 'magelens_probe',
                ]);
                break;
            case 'publish':
                $this->publisher->publish('magelens.probe', $value);
                break;
            case 'received':
                $marker = Jobs::marker($value);
                $output->writeln(is_file($marker) ? file_get_contents($marker) : 'pending');
                break;
            case 'clean':
                $marker = Jobs::marker($value);
                if (is_file($marker)) {
                    unlink($marker);
                }
                break;
            default:
                ($output instanceof ConsoleOutputInterface ? $output->getErrorOutput() : $output)
                    ->writeln('Unknown probe action');
                return self::INVALID;
        }
        return self::SUCCESS;
    }

    private function schedule(string $id): Schedule
    {
        $schedule = $this->schedules->create();
        $this->resource->load($schedule, $id);
        if ($schedule->getJobCode() !== 'magelens_probe') {
            throw new \RuntimeException('Unknown probe schedule');
        }
        return $schedule;
    }
}
