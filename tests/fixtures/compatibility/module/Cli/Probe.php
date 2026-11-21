<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);

namespace MageLens\Compatibility\Cli;

use Magento\Cron\Model\ConfigFactory;
use Magento\Cron\Model\ResourceModel\Schedule as ScheduleResource;
use Magento\Cron\Model\Schedule;
use Magento\Cron\Model\ScheduleFactory;
use Magento\Cron\Observer\ProcessCronQueueObserver;
use Magento\Framework\App\CacheInterface;
use Magento\Framework\Config\CacheInterface as CronConfigCache;
use Magento\Framework\MessageQueue\PublisherInterface;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\ConsoleOutputInterface;
use Symfony\Component\Console\Output\OutputInterface;

class Probe extends Command
{
    private const CRON_PROBES = ['magelens_probe', 'magelens_failing_probe', 'magelens_generated_probe',
        '123', '0123', 'magelens_scoped_probe', '456'];
    private const GENERATED_JOBS = [
        'magelens_generated_probe' => ['magelens_generated_probe'],
        '123' => ['123', '0123', 'magelens_scoped_probe'],
    ];

    public function __construct(
        private readonly ScheduleFactory $schedules,
        private readonly ScheduleResource $resource,
        private readonly PublisherInterface $publisher,
        private readonly CacheInterface $cache,
        private readonly CronConfigCache $cronConfigCache,
        private readonly ConfigFactory $cronConfig
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
            case 'fork':
                $pid = pcntl_fork();
                if ($pid === -1) throw new \RuntimeException('Fork failed');
                if ($pid === 0) {
                    $output->writeln(trim($value));
                    exit(0);
                }
                pcntl_waitpid($pid, $status);
                return pcntl_wifexited($status) ? pcntl_wexitstatus($status) : self::FAILURE;
            case 'schedule':
                if (!in_array($value, self::CRON_PROBES, true)) {
                    throw new \InvalidArgumentException('Unknown probe job');
                }
                $now = time();
                $schedule = $this->schedules->create()
                    ->setJobCode($value)
                    ->setStatus(Schedule::STATUS_PENDING)
                    ->setCreatedAt(gmdate('Y-m-d H:i:s', $now))
                    ->setScheduledAt(gmdate('Y-m-d H:i:00', $now - 60));
                $this->resource->save($schedule);
                $output->writeln((string) $schedule->getId());
                break;
            case 'status':
                $output->writeln($this->schedule($value)->getStatus());
                break;
            case 'messages':
                $output->writeln((string) $this->schedule($value)->getMessages());
                break;
            case 'unschedule':
                $this->resource->getConnection()->delete($this->resource->getMainTable(), [
                    'schedule_id = ?' => $value,
                    'job_code IN (?)' => self::CRON_PROBES,
                ]);
                break;
            case 'generated-schedules':
            case 'magerun-messages':
                $column = $input->getArgument('action') === 'generated-schedules' ? 'status' : 'messages';
                $db = $this->resource->getConnection();
                $query = $db->select()->from($this->resource->getMainTable(), [$column])
                    ->where('job_code = ?', $this->probeJob($value))->order('scheduled_at');
                $output->writeln(json_encode($db->fetchCol($query), JSON_THROW_ON_ERROR));
                break;
            case 'delete-generated':
            case 'clean-generated':
                if (!isset(self::GENERATED_JOBS[$value])) throw new \InvalidArgumentException('Unknown probe group');
                $this->resource->getConnection()->delete($this->resource->getMainTable(), [
                    'job_code IN (?)' => self::GENERATED_JOBS[$value],
                ]);
                if ($input->getArgument('action') === 'clean-generated') {
                    $this->cache->remove(ProcessCronQueueObserver::CACHE_KEY_LAST_SCHEDULE_GENERATE_AT . $value);
                }
                break;
            case 'cold-cron-config':
                $this->cronConfigCache->remove('crontab_config_cache');
                break;
            case 'expire-cron-cleanup':
                if (!isset(self::GENERATED_JOBS[$value])) throw new \InvalidArgumentException('Unknown probe group');
                $this->cache->remove(ProcessCronQueueObserver::CACHE_KEY_LAST_HISTORY_CLEANUP_AT . $value);
                break;
            case 'other-cron-groups':
                $groups = array_map('strval', array_keys($this->cronConfig->create()->getJobs()));
                $output->writeln(json_encode(array_values(array_diff($groups, [$value])), JSON_THROW_ON_ERROR));
                break;
            case 'clean-magerun':
                $this->resource->getConnection()->delete($this->resource->getMainTable(), [
                    'job_code = ?' => $this->probeJob($value),
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
        if (!in_array($schedule->getJobCode(), self::CRON_PROBES, true)) {
            throw new \RuntimeException('Unknown probe schedule');
        }
        return $schedule;
    }

    private function probeJob(string $job): string
    {
        if ($job !== 'magelens_magerun_probe' && !in_array($job, self::CRON_PROBES, true)) {
            throw new \InvalidArgumentException('Unknown probe job');
        }
        return $job;
    }
}
