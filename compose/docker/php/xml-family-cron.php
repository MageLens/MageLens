<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Cron\Model\Config\Reader\Xml as CronReader;
use Magento\Framework\Config\FileResolverInterface;
use Magento\Framework\Config\Reader\Filesystem;
use Magento\Framework\ObjectManager\ConfigInterface;
use Magento\Framework\ObjectManager\ConfigLoaderInterface;

require_once __DIR__ . '/xml-cron-runtime.php';

final class CronFamily
{
    public static function declarations(string $path, string $bytes): ?array
    {
        if (!str_ends_with($path, '/etc/crontab.xml')) return null;
        $dom = Xml::document($bytes);
        return self::inventory($path, $bytes, $dom);
    }

    private static function inventory(string $path, string $bytes, \DOMDocument $dom): array
    {
        $ranges = Xml::ranges($bytes, $dom, true);
        $items = [];
        foreach ((new \DOMXPath($dom))->query('/config/group/job') as $job) {
            $group = $job->parentNode->getAttribute('id');
            $code = $job->getAttribute('name');
            $identity = "$group/$code";
            $handler = FamilyEvidence::declaration($path, 'cron', $job, $ranges, $identity,
                ['cron-handler-entered', 'cron-handler-completed']);
            $handler['binding'] = ['group' => $group, 'job' => $code, 'kind' => 'handler',
                'instance' => $job->getAttribute('instance'), 'method' => $job->getAttribute('method')];
            $items[] = $handler;
            foreach ($job->childNodes as $node) {
                if (!$node instanceof \DOMElement || !in_array($node->tagName, ['schedule', 'config_path'], true)) continue;
                $kind = $node->tagName;
                $schedule = FamilyEvidence::declaration($path, 'cron', $node, $ranges, "$identity#$kind", ['cron-schedule-evaluated']);
                $schedule['binding'] = ['group' => $group, 'job' => $code, 'kind' => $kind];
                if ($kind === 'config_path') {
                    self::limit($schedule, 'Scope configuration cron expressions have unmeasured XML provenance');
                } elseif ($job->getElementsByTagName('config_path')->length) {
                    self::limit($schedule, 'A scope configuration path can replace this literal schedule', 'ambiguous');
                }
                $items[] = $schedule;
            }
        }
        return $items;
    }

    private static function limit(array &$item, string $reason, string $outcome = 'unsupported'): void
    {
        $item['supported'] = $item['effective'] = false;
        $item['reason'] = $reason;
        $item['outcome'] = $outcome;
    }

    public static function prepare($om, array &$files): array
    {
        $reader = $om->get(CronReader::class);
        $resolverProperty = new \ReflectionProperty(Filesystem::class, '_fileResolver');
        $resolver = $resolverProperty->getValue($reader);
        $copy = clone $reader;
        $sourceList = new class implements FileResolverInterface {
            public array $sources = [];
            public function get($filename, $scope = null) { return $this->sources; }
        };
        $sourceList->sources = iterator_to_array((function () use ($resolver) {
            yield from $resolver->get('crontab.xml', 'global');
        })());
        $resolverProperty->setValue($copy, $sourceList);
        $native = $copy->read('global');

        $origins = $providers = $contributors = [];
        foreach ($sourceList->sources as $absolute => $bytes) {
            $providers[$absolute] = hash('sha256', $bytes);
            $relative = str_starts_with($absolute, BP . '/') ? substr($absolute, strlen(BP) + 1) : $absolute;
            foreach (self::inventory($relative, $bytes, Xml::document($bytes)) as $item) {
                $binding = $item['binding'];
                $origins[$item['path']][] = $item['id'];
                if ($binding['kind'] === 'handler') $contributors[$binding['group']][$binding['job']][] = $item['id'];
            }
        }

        $data = clone $om->get(ConfigInterface::class);
        $data->extend($om->get(ConfigLoaderInterface::class)->load('crontab'));
        $jobs = [];
        foreach ($files as $path => &$file) foreach ($file['declarations'] as &$item) {
            if ($item['family'] !== 'cron' || !$item['supported']) continue;
            ['group' => $group, 'job' => $code, 'kind' => $kind] = $item['binding'];
            if (($providers[BP . '/' . $path] ?? null) !== $file['sourceHash']) {
                self::limit($item, 'Original cron XML is inactive in the native reader');
                continue;
            }
            if (($origins[$item['path']] ?? []) !== [$item['id']] || count($contributors[$group][$code] ?? []) !== 1) {
                self::limit($item, 'Multiple original declarations contribute to this native cron job', 'ambiguous');
                continue;
            }
            $nativeJob = $native[$group][$code] ?? [];
            if ($kind === 'schedule') {
                if (!is_string($nativeJob['schedule'] ?? null) || isset($nativeJob['config_path'])) {
                    self::limit($item, 'The native cron job has no uniquely attributable literal expression', 'displaced');
                } else {
                    $jobs[$group][$code]['schedule'] = ['id' => $item['id'], 'expression' => $nativeJob['schedule']];
                }
                continue;
            }
            ['instance' => $instance, 'method' => $method] = $item['binding'];
            if (($nativeJob['instance'] ?? null) !== $instance || ($nativeJob['method'] ?? null) !== $method) {
                self::limit($item, 'The native cron reader selected a different callback binding', 'displaced');
                continue;
            }

            $receiver = NativeCall::implementation($data->getInstanceType($data->getPreference($instance)));
            if (!method_exists($receiver, $method)) {
                self::limit($item, 'The configured callback has no concrete public method');
                continue;
            }
            $callback = new \ReflectionMethod($receiver, $method);
            if (!$callback->isPublic() || $callback->isAbstract() || $callback->isStatic()) {
                self::limit($item, 'The configured callback has no concrete public instance method');
                continue;
            }
            $jobs[$group][$code]['handler'] = ['id' => $item['id'], 'instance' => $instance, 'method' => $method,
                'receiver' => $receiver, 'declaring' => $callback->class, 'callback' => $callback->getName()];
        }
        unset($item, $file);
        return [['jobs' => $jobs, 'providers' => $providers, 'config' => self::fingerprint($native)], $providers];
    }

    public static function fingerprint(array $data): string
    {
        return hash('sha256', Xml::canonical($data));
    }

    public static function hooks(array $targets): array
    {
        return (new CronRuntime($targets))->hooks();
    }
}
