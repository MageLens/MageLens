<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\Interception\ObjectManager\Config\Developer as DeveloperConfig;
use Magento\Framework\ObjectManager\Config\Config;
use Magento\Framework\ObjectManager\Factory\Dynamic\Developer as DeveloperFactory;
use Magento\Framework\ObjectManager\Relations\Runtime;

final class DiUsage
{
    private static array $enabled = [];
    private static array $seen = [];
    private static array $frames = [];
    private static array $context = [];
    private static array $origins = [];
    private static ?string $area = null;
    private static ?string $factoryFile = null;
    private static ?\WeakReference $factory = null;
    private static ?\WeakReference $config = null;
    private static ?DeveloperConfig $fresh = null;
    private static ?Runtime $relations = null;
    private static bool $broken = false;
    private static bool $stale = false;

    public static function hooks(array $areas): array
    {
        foreach ($areas as $area) self::$enabled += $area['diUsage']['eligible'] ?? [];
        if (!self::$enabled) return [];
        $hooks = [
            [DeveloperFactory::class, 'create',
                static function ($factory, array $params, string $class) {
                    if ($class !== DeveloperFactory::class || self::$factory?->get() !== $factory) return;
                    $type = $params[0] ?? null;
                    $route = is_string($type) ? (self::$context['virtualRoutes'][$type] ?? null) : null;
                    self::$frames[] = ['requested' => $type, 'area' => self::$area, 'virtual' => $route, 'lookedUp' => false,
                        'constructor' => null, 'read' => false, 'arguments' => []];
                },
                static function ($factory, array $params, $result, ?\Throwable $error, string $class) {
                    if ($class !== DeveloperFactory::class || self::$factory?->get() !== $factory) return;
                    self::returned($result, $error);
                }],
        ];
        if (isset(self::$enabled['virtual-types'])) {
            $hooks[] = [DeveloperConfig::class, 'getInstanceType', null,
                static function ($config, array $params, $result, ?\Throwable $error, string $class) {
                    $index = array_key_last(self::$frames);
                    if ($index === null || $class !== DeveloperConfig::class || $error || self::$config?->get() !== $config) return;
                    $frame = &self::$frames[$index];
                    if ($frame['lookedUp'] || (!$frame['virtual'] && isset(self::$seen['virtual-types']))) return;
                    $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3);
                    if (!self::site($trace, 49, 'create')) return;
                    $frame['lookedUp'] = true;
                    self::$seen['virtual-types'] = true;
                    $expected = $frame['virtual']['resolved'] ?? null;
                    if ($expected !== null && $result !== $expected && $result !== $expected . '\\Interceptor') self::$stale = true;
                }];
        }
        if (isset(self::$enabled['arguments'])) {
            $hooks[] = [DeveloperFactory::class, '_resolveArguments',
                static function ($factory, array $params, string $class) {
                    $index = array_key_last(self::$frames);
                    if ($index === null || $class !== DeveloperFactory::class || self::$factory?->get() !== $factory) return;
                    $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3);
                    if (!self::site($trace, 61, 'create')) return;
                    self::$frames[$index]['constructor'] = array_fill_keys(array_column($params[1], 0), true);
                    foreach ($params[2] ?? [] as $name => $value) unset(self::$frames[$index]['constructor'][$name]);
                }, null];
            $hooks[] = [Config::class, 'getArguments', null,
                static function ($config, array $params, $result, ?\Throwable $error, string $class) {
                    $index = array_key_last(self::$frames);
                    if ($index === null || $class !== Config::class || $error || self::$config?->get() !== $config || !is_array($result)) return;
                    $frame = &self::$frames[$index];
                    if ($frame['constructor'] === null || $frame['read']) return;
                    $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3);
                    if (!self::site($trace, 27, '_resolveArguments')) return;
                    $frame['read'] = true;
                    self::$seen['arguments'] = true;
                    $candidates = array_intersect_key($frame['constructor'], self::$context['names'] ?? []);
                    if (!$candidates || !is_string($frame['requested']) || !self::$fresh) return;
                    if (self::$area !== $frame['area']) {
                        self::$broken = true;
                        return;
                    }
                    $type = $frame['requested'];
                    $arguments = array_intersect_key(self::argumentOrigins($type), $candidates);
                    foreach ($arguments as $name => $entry) {
                        if ($entry['id'] !== null) $frame['arguments'][$name] = $entry['id'];
                    }
                    if (!$frame['arguments']) return;
                    $expected = array_intersect_key(self::$fresh->getArguments($type), $frame['arguments']);
                    if (count($expected) !== count($frame['arguments']) || array_intersect_key($result, $frame['arguments']) !== $expected) {
                        self::$stale = true;
                        $frame['arguments'] = [];
                    }
                }];
        }
        return $hooks;
    }

    private static function site(array $trace, int $line, string $method): bool
    {
        return ($trace[1]['file'] ?? null) === self::$factoryFile && ($trace[1]['line'] ?? null) === $line
            && ($trace[2]['class'] ?? null) === DeveloperFactory::class && ($trace[2]['function'] ?? null) === $method;
    }

    public static function hasArgumentMeasurement(): bool
    {
        return isset(self::$enabled['arguments']);
    }

    public static function area(?string $area, object $factory, DeveloperConfig $config, array $expected = []): void
    {
        if (!self::$enabled) return;
        self::$area = $area;
        self::$context = $expected;
        self::$origins = [];
        self::$fresh = self::$relations = null;
        self::$factoryFile ??= (new \ReflectionClass(DeveloperFactory::class))->getFileName();
        self::$factory = \WeakReference::create($factory);
        self::$config = \WeakReference::create($config);
        if (!($expected['names'] ?? [])) return;
        $relations = (new \ReflectionProperty(Config::class, '_relations'))->getValue($config);
        if (get_class($relations) !== Runtime::class || !DiUsageManifest::nativeArguments()) {
            self::$broken = true;
            return;
        }
        self::$relations = $relations;
        // Check the live merged cache against the native merge starting from
        // verified raw maps. The copy never changes the application's config.
        self::$fresh = clone $config;
        (new \ReflectionProperty(Config::class, '_mergedArguments'))->setValue(self::$fresh, []);
    }

    private static function argumentOrigins(string $type): array
    {
        if (isset(self::$origins[$type])) return self::$origins[$type];
        $virtual = self::$context['virtual'][$type] ?? null;
        if ($virtual !== null) {
            $owners = self::argumentOrigins($virtual);
        } else {
            $owners = [];
            if (self::$relations->has($type)) foreach (self::$relations->getParents($type) as $parent) {
                if ($parent) $owners = array_replace($owners, self::argumentOrigins($parent));
            }
        }
        foreach (self::$context['arguments'][$type] ?? [] as $name => $entry) {
            if ($entry['array'] && ($owners[$name]['array'] ?? false) && $entry['id'] !== $owners[$name]['id']) {
                // Native recursive merging can retain values from both arrays.
                $entry['id'] = null;
            }
            $owners[$name] = $entry;
        }
        return self::$origins[$type] = $owners;
    }

    private static function returned(mixed $object, ?\Throwable $error): void
    {
        if (!self::$frames) {
            self::$broken = true;
            return;
        }
        $frame = array_pop(self::$frames);
        if ($error || !is_object($object) || $frame['area'] === null) return;
        if ($frame['virtual']) {
            if (!$frame['lookedUp']) self::$broken = true;
            else foreach ($frame['virtual']['ids'] as $id) {
                Recorder::diUsage($id, 'virtual-type-resolved', $frame['area'], $frame['requested']);
            }
        }
        if ($frame['constructor'] !== null && !$frame['read']) self::$broken = true;
        foreach ($frame['arguments'] as $id) Recorder::diUsage($id, 'argument-applied', $frame['area'], $frame['requested']);
    }

    public static function finish(): array
    {
        if (self::$stale) PreferenceManifest::stale('factory DI differs from its prepared configuration');
        if (self::$broken || self::$frames) throw new \RuntimeException('Magento DI usage hooks did not confirm the native developer factory path');
        return self::$seen;
    }
}
