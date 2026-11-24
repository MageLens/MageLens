<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Cron\Model\Config;
use Magento\Cron\Model\Config\Data as CronData;
use Magento\Cron\Model\Config\Reader\Db;
use Magento\Cron\Model\Config\Reader\Xml as CronReader;
use Magento\Cron\Model\Schedule;
use Magento\Cron\Observer\ProcessCronQueueObserver as Observer;
use Magento\Framework\Config\Data as ConfigData;
use Magento\Framework\Config\FileIterator;
use Magento\Framework\Config\Reader\Filesystem;
use Magento\Framework\DataObject;
use N98\Magento\Command\System\Cron\AbstractCronCommand;
use N98\Magento\Command\System\Cron\RunCommand;

require_once __DIR__ . '/xml-native-call.php';

final class CronRuntime
{
    private array $constructors = [];
    private array $reads = [];
    private array $generation = [];
    private array $saving = [];
    private array $execution = [];
    private array $direct = [];
    private array $callbacks = [];
    private \WeakMap $origins;
    private \WeakMap $latest;
    private \ReflectionProperty $observerConfig;
    private \ReflectionProperty $configData;
    private \ReflectionProperty $jobData;

    public function __construct(private readonly array $targets)
    {
        $this->origins = new \WeakMap();
        $this->latest = new \WeakMap();
    }

    public function hooks(): array
    {
        if (!$this->targets['jobs']) return [];
        $hooks = [
            [CronData::class, '__construct', $this->beginConfig(...), $this->endConfig(...)],
            [Filesystem::class, '_readFiles', $this->beginRead(...), $this->endRead(...)],
            [FileIterator::class, 'current', null, $this->providerBytes(...)],
            [FileIterator::class, 'key', null, $this->providerKey(...)],
            [Db::class, 'get', null, $this->overrides(...)],
            [ConfigData::class, 'merge', $this->merge(...), null],
            [Config::class, 'getJobs', null, $this->jobList(...)],
            [Observer::class, '_generateJobs', $this->beginGeneration(...), $this->endGeneration(...)],
            [Observer::class, 'saveSchedule', $this->beginSaving(...), $this->endSaving(...)],
            [Observer::class, 'createSchedule', null, $this->createdSchedule(...)],
            [Schedule::class, 'trySchedule', null, $this->evaluatedSchedule(...)],
            [Observer::class, '_runJob', $this->beginExecution(...), $this->endExecution(...)],
        ];
        if (PHP_SAPI === 'cli') {
            $hooks[] = [RunCommand::class, 'execute', $this->beginDirect(...), $this->endDirect(...)];
            $hooks[] = [AbstractCronCommand::class, 'getJobForExecuteMethod', null, $this->directSelection(...)];
        }
        $callbacks = [];
        foreach ($this->targets['jobs'] as $jobs) foreach ($jobs as $job) {
            if (!isset($job['handler'])) continue;
            ['declaring' => $declaring, 'callback' => $method] = $job['handler'];
            $callbacks[$declaring . '::' . $method] = [$declaring, $method, $this->handlerEntry(...), $this->handlerReturn(...)];
        }
        return [...$hooks, ...array_values($callbacks)];
    }

    private function beginConfig($subject, array $args, string $class): void
    {
        if ($class === CronData::class && self::native($subject, CronData::class)) {
            $this->constructors[] = ['data' => $subject, 'reader' => $args[0] ?? null,
                'fresh' => false, 'merges' => 0, 'displaced' => []];
        }
    }

    private function endConfig($subject, array $args, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->constructors);
        if (($this->constructors[$index]['data'] ?? null) !== $subject || $class !== CronData::class) return;
        $frame = array_pop($this->constructors);
        unset($frame['data'], $frame['reader']);
        $frame['fresh'] = $frame['fresh'] && $frame['merges'] === 2;
        if (!$error) $this->origins[$subject] = $frame;
    }

    private function beginRead($subject, array $args, string $class): void
    {
        $index = array_key_last($this->constructors);
        if ($class !== Filesystem::class || !self::native($subject, CronReader::class)
            || ($this->constructors[$index]['reader'] ?? null) !== $subject) return;
        $this->constructors[$index]['sawRead'] = true;
        $sources = $args[0] ?? null;
        $proof = [];
        if (is_array($sources)) foreach ($sources as $file => $bytes) $proof[$file] = hash('sha256', $bytes);
        $this->reads[] = ['reader' => $subject, 'files' => $sources instanceof FileIterator ? $sources : null, 'hashes' => $proof];
    }

    private function endRead($subject, array $args, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Filesystem::class || (end($this->reads)['reader'] ?? null) !== $subject) return;
        $frame = array_pop($this->reads);
        $index = array_key_last($this->constructors);
        if ($index !== null && !$error && is_array($result) && $frame['hashes'] === $this->targets['providers']
            && CronFamily::fingerprint($result) === $this->targets['config']) {
            $this->constructors[$index]['source'] = $this->targets['config'];
        }
    }

    private function providerBytes($subject, array $args, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->reads);
        if ($class !== FileIterator::class || !$subject || ($this->reads[$index]['files'] ?? null) !== $subject) return;
        $this->reads[$index]['hash'] = !$error && is_string($result) ? hash('sha256', $result) : null;
    }

    private function providerKey($subject, array $args, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->reads);
        if ($class !== FileIterator::class || !$subject || ($this->reads[$index]['files'] ?? null) !== $subject
            || !isset($this->reads[$index]['hash']) || $error || !is_string($result)) return;
        $this->reads[$index]['hashes'][$result] = $this->reads[$index]['hash'];
        unset($this->reads[$index]['hash']);
    }

    private function overrides($subject, array $args, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->constructors);
        if ($index === null || $class !== Db::class || !self::native($subject, Db::class) || $error || !is_array($result)) return;
        $this->constructors[$index]['database'] = CronFamily::fingerprint($result);
    }

    private function merge($subject, array $args, string $class): void
    {
        if ($class !== ConfigData::class || !self::native($subject, CronData::class) || !is_array($args[0] ?? null)) return;
        $index = array_key_last($this->constructors);
        if (($this->constructors[$index]['data'] ?? null) === $subject) {
            $frame = &$this->constructors[$index];
            if ($frame['merges']++ === 0) {
                $frame['fresh'] = isset($frame['source']) && CronFamily::fingerprint($args[0]) === $frame['source'];
            } elseif ($frame['merges'] !== 2 || !isset($frame['database']) || CronFamily::fingerprint($args[0]) !== $frame['database']) {
                $frame['fresh'] = false;
            } else {
                self::markOverrides($frame['displaced'], $args[0]);
            }
        } elseif (isset($this->origins[$subject])) {
            $origin = $this->origins[$subject];
            self::markOverrides($origin['displaced'], $args[0]);
            $this->origins[$subject] = $origin;
        }
    }

    private static function markOverrides(array &$displaced, array $changes): void
    {
        foreach ($changes as $group => $jobs) foreach ((array) $jobs as $code => $job) {
            if (!is_array($job)) {
                $displaced[$group][$code] = ['handler' => true, 'schedule' => true];
                continue;
            }
            foreach (['handler' => ['name', 'instance', 'method'], 'schedule' => ['name', 'schedule', 'config_path']] as $kind => $keys) {
                if (array_intersect($keys, array_keys($job))) $displaced[$group][$code][$kind] = true;
            }
        }
    }

    private function jobList($subject, array $args, $result, ?\Throwable $error, string $class): void
    {
        if (!$error && is_array($result) && $class === Config::class && self::native($subject, Config::class)) {
            $this->latest[$subject] = $result;
        }
    }

    private function beginGeneration($subject, array $args, string $class): void
    {
        if ($class === Observer::class && self::native($subject, Observer::class)) {
            $this->generation[] = ['owner' => $subject, 'group' => self::identifier($args[2] ?? null), 'jobs' => $args[0] ?? []];
        }
    }

    private function endGeneration($subject, array $args, $result, ?\Throwable $error, string $class): void
    {
        if ($class === Observer::class && (end($this->generation)['owner'] ?? null) === $subject) array_pop($this->generation);
    }

    private function beginSaving($subject, array $args, string $class): void
    {
        $generation = end($this->generation);
        if ($class !== Observer::class || ($generation['owner'] ?? null) !== $subject) return;
        $code = self::identifier($args[0] ?? null);
        $group = $generation['group'];
        $target = $group !== null && $code !== null ? ($this->targets['jobs'][$group][$code]['schedule'] ?? null) : null;
        $binding = $code === null ? [] : ($generation['jobs'][$code] ?? []);
        $this->saving[] = ['owner' => $subject, 'code' => $code, 'group' => $group, 'target' => $target,
            'matches' => $target && !isset($binding['config_path']) && ($args[1] ?? null) === $target['expression']];
    }

    private function endSaving($subject, array $args, $result, ?\Throwable $error, string $class): void
    {
        if ($class === Observer::class && (end($this->saving)['owner'] ?? null) === $subject) array_pop($this->saving);
    }

    private function createdSchedule($subject, array $args, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->saving);
        if (!$error && $class === Observer::class && ($this->saving[$index]['owner'] ?? null) === $subject
            && ($this->saving[$index]['code'] ?? null) === self::identifier($args[0] ?? null) && self::native($result, Schedule::class)) {
            $this->saving[$index]['schedule'] = $result;
        }
    }

    private function evaluatedSchedule($subject, array $args, $result, ?\Throwable $error, string $class): void
    {
        $frame = end($this->saving);
        if ($error || !is_bool($result) || $class !== Schedule::class || ($frame['schedule'] ?? null) !== $subject || !$frame['target']
            || !$this->atScheduleCallSite($frame['owner'])) return;
        $data = $this->scheduleData($subject);
        if (empty($data['scheduled_at']) || empty($data['cron_expr_arr'])) return;
        $target = $frame['target'];
        $expr = preg_split('#\s+#', $target['expression'], -1, PREG_SPLIT_NO_EMPTY);
        $outcome = $this->decision($this->observerConfig($frame['owner']), $frame['group'], $frame['code'], 'schedule',
            $frame['matches'] && $data['cron_expr_arr'] === $expr);
        Recorder::familyEvidence($target['id'], 'cron-schedule-evaluated', 'crontab', ...($outcome ?? ['observed']));
    }

    private function beginExecution($subject, array $args, string $class): void
    {
        if ($class !== Observer::class || !self::native($subject, Observer::class)) return;
        $schedule = $args[3] ?? null;
        $group = self::identifier($args[4] ?? null);
        $code = self::native($schedule, Schedule::class) ? self::identifier($this->scheduleData($schedule)['job_code'] ?? null) : null;
        $target = $group !== null && $code !== null ? ($this->targets['jobs'][$group][$code]['handler'] ?? null) : null;
        $binding = $args[2] ?? [];
        $outcome = $target ? $this->decision($this->observerConfig($subject), $group, $code, 'handler', self::matches($binding, $target)) : null;
        $this->execution[] = ['owner' => $subject, 'schedule' => $schedule, 'target' => $target, 'outcome' => $outcome];
    }

    private function endExecution($subject, array $args, $result, ?\Throwable $error, string $class): void
    {
        if ($class === Observer::class && (end($this->execution)['owner'] ?? null) === $subject) array_pop($this->execution);
    }

    private function beginDirect($subject, array $args, string $class): void
    {
        if ($class === RunCommand::class && self::native($subject, RunCommand::class)) $this->direct[] = ['owner' => $subject];
    }

    private function endDirect($subject, array $args, $result, ?\Throwable $error, string $class): void
    {
        if ($class === RunCommand::class && (end($this->direct)['owner'] ?? null) === $subject) array_pop($this->direct);
    }

    private function directSelection($subject, array $args, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->direct);
        if ($error || $class !== AbstractCronCommand::class || !is_array($result) || count($result) !== 3
            || ($this->direct[$index]['owner'] ?? null) !== $subject) return;
        [$code, $binding, $receiver] = $result;
        $code = self::identifier($code);
        if ($code === null || !is_array($binding)) return;
        $config = (new \ReflectionProperty(AbstractCronCommand::class, 'cronConfig'))->getValue($subject);
        $groups = [];
        foreach ($this->latest[$config] ?? [] as $group => $jobs) foreach ($jobs as $job => $data) {
            // MageRun returns the first loose match. Retain its actual key,
            // and verify the returned binding before crediting that declaration.
            if (isset($data['name']) && ($data['name'] == $code || $job == $code)) {
                $groups[] = [(string) $group, (string) $job, $data];
            }
        }
        if (!$groups) return;
        [$group, $job, $selected] = $groups[0];
        $target = $this->targets['jobs'][$group][$job]['handler'] ?? null;
        if (!$target) return;

        $duplicates = array_filter(array_slice($groups, 1), static fn(array $candidate) =>
            $candidate[1] === $job || $candidate[2] === $binding);
        $outcome = $duplicates ? ['ambiguous', 'MageRun named selection has several matching native cron jobs']
            : $this->decision($config, $group, $job, 'handler', $selected === $binding && self::matches($binding, $target));
        $this->direct[$index] += ['target' => $target, 'outcome' => $outcome,
            'receiver' => $receiver, 'code' => $code];
    }

    private function handlerEntry($subject, array $args, string $class, string $method): void
    {
        $this->callbacks[] = null;
        $execution = end($this->execution);
        $direct = end($this->direct);
        $schedule = $args[0] ?? null;
        if (!self::native($schedule, Schedule::class) || str_ends_with($class, '\\Interceptor')) return;
        if (isset($execution['target']) && $execution['schedule'] === $schedule
            && NativeCall::matches($subject, $class, $method, $execution['owner'], Observer::class, '_runJob',
                'call_user_func_array($callback, [$schedule]);')) {
            $frame = &$this->execution[array_key_last($this->execution)];
        } elseif (isset($direct['target']) && $subject === $direct['receiver']
            && self::identifier($this->scheduleData($schedule)['job_code'] ?? null) === $direct['code']
            && NativeCall::matches($subject, $class, $method, $direct['owner'], RunCommand::class, 'execute',
                '$model->{$jobConfig[\'method\']}($schedule);')) {
            $frame = &$this->direct[array_key_last($this->direct)];
        } else {
            return;
        }
        $target = $frame['target'];
        if (isset($frame['claimed']) || $method !== $target['callback'] || !self::native($subject, $target['receiver'])
            || $class !== $target['declaring']) return;
        // Attribute the first body entered by this dispatch.
        $frame['claimed'] = true;
        $this->callbacks[array_key_last($this->callbacks)] = ['id' => $target['id'], 'outcome' => $frame['outcome']];
    }

    private function handlerReturn($subject, array $args, $result, ?\Throwable $error, string $class, string $method, string $file, int $line): void
    {
        $frame = array_pop($this->callbacks);
        if (!$frame) return;
        $id = $frame['id'];
        $outcome = $frame['outcome'];
        if (!$outcome && $error instanceof \TypeError && $error->getFile() === $file && $error->getLine() === $line) {
            $outcome = ['ambiguous', 'A callback type error occurred at the native method declaration'];
        }
        Recorder::familyEvidence($id, 'cron-handler-entered', 'crontab', ...($outcome ?? ['entered']));
        Recorder::familyEvidence($id, 'cron-handler-completed', 'crontab', ...($outcome ?? [$error ? 'failed' : 'completed']));
    }

    private function atScheduleCallSite(object $owner): bool
    {
        $site = NativeCall::site(Observer::class, 'saveSchedule', '$valid = $schedule->trySchedule();');
        if ($site === null) return false;
        // Observe the native expression evaluator inside a Schedule interceptor, if present.
        $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS | DEBUG_BACKTRACE_PROVIDE_OBJECT, 30);
        foreach ($trace as $index => $frame) {
            if (($frame['object'] ?? null) !== $owner || ($frame['class'] ?? null) !== Observer::class
                || $frame['function'] !== 'saveSchedule') continue;
            $callee = $trace[$index - 1] ?? [];
            return ($callee['file'] ?? null) === $site[0] && ($callee['line'] ?? null) === $site[1];
        }
        return false;
    }

    private function decision(mixed $config, string $group, string $job, string $kind, bool $matches): ?array
    {
        if (!self::native($config, Config::class)) return ['ambiguous', 'The effective cron configuration provider is unmeasured'];
        $this->configData ??= new \ReflectionProperty(Config::class, '_configData');
        $data = $this->configData->getValue($config);
        $origin = $this->origins[$data] ?? [];
        if (isset($origin['displaced'][$group][$job][$kind]) || !$matches) {
            return ['displaced', 'Native cron configuration or runtime dispatch replaced the XML binding'];
        }
        if (!($origin['fresh'] ?? false)) {
            return ($origin['sawRead'] ?? false)
                ? ['ambiguous', 'The native cron reader did not confirm the original configuration providers']
                : ['cache-only', 'This process did not verify the original cron configuration providers'];
        }
        return null;
    }

    private function observerConfig(object $subject): mixed
    {
        $this->observerConfig ??= new \ReflectionProperty(Observer::class, '_config');
        return $this->observerConfig->getValue($subject);
    }

    private function scheduleData(object $schedule): array
    {
        $this->jobData ??= new \ReflectionProperty(DataObject::class, '_data');
        return $this->jobData->getValue($schedule);
    }

    private static function matches(array $binding, array $target): bool
    {
        return ($binding['instance'] ?? null) === $target['instance'] && ($binding['method'] ?? null) === $target['method'];
    }

    private static function identifier(mixed $value): ?string
    {
        return is_int($value) || is_string($value) ? (string) $value : null;
    }

    private static function native(mixed $object, string $class): bool
    {
        return is_object($object) && in_array(get_class($object), [$class, $class . '\\Interceptor'], true);
    }
}
