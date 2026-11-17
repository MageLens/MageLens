<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\App\Area;
use Magento\Framework\App\Http;
use Magento\Framework\App\StaticResource;
use Magento\Framework\App\ObjectManager\ConfigLoader;
use Magento\Framework\App\ObjectManager\ConfigLoader\Compiled as CompiledLoader;
use Magento\Framework\App\ObjectManager\Environment\Compiled as CompiledEnvironment;
use Magento\Framework\App\ObjectManager\Environment\Developer as DeveloperEnvironment;
use Magento\Framework\Interception\ObjectManager\Config\Compiled as InterceptingCompiled;
use Magento\Framework\Interception\ObjectManager\Config\Developer as DeveloperConfig;
use Magento\Framework\ObjectManager\Config\Config;
use Magento\Framework\ObjectManager\Config\Compiled as CompiledConfig;
use Magento\Framework\ObjectManager\Factory\Compiled as CompiledFactory;
use Magento\Framework\ObjectManager\Factory\Dynamic\Developer as DeveloperFactory;
use Magento\Framework\ObjectManager\ObjectManager;

final class Preferences
{
    private static array $areas = [];
    private static ?string $area = null;
    private static ?array $loaded = null;
    private static ?\WeakReference $manager = null;
    private static ?\WeakReference $config = null;
    private static ?\WeakReference $extended = null;
    private static array $frames = [];
    private static array $seen = [];
    private static bool $global = false;
    private static ?string $stale = null;
    private static bool $broken = false;
    private static ?string $managerFile = null;
    private static bool $compiled = false;

    public static function hooks(array $areas): array
    {
        if (!$areas) return [];
        self::$areas = $areas;
        self::$compiled = $areas['global']['compiled'] ?? false;
        $loaderClass = self::$compiled ? CompiledLoader::class : ConfigLoader::class;
        $configClass = self::$compiled ? CompiledConfig::class : Config::class;
        $hooks = [
            [$loaderClass, 'load', null, static function ($loader, array $params, $result, ?\Throwable $error, string $class) use ($loaderClass) {
                $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3);
                $site = self::scopeSite($trace[2] ?? []);
                if ($site && !$error && $class === $loaderClass && is_array($result)) {
                    $area = $params[0] ?? null;
                    $arguments = isset(self::$areas[$area]['diUsage']['argumentDelta']) ? DiUsageManifest::argumentDelta($result) : null;
                    self::$loaded = [$site, $area, PreferenceManifest::deltaHash($result, self::$compiled), $arguments];
                }
            }],
            [ObjectManager::class, 'configure', null, static function ($manager, array $params, $result, ?\Throwable $error, string $class) {
                $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3);
                $site = self::scopeSite($trace[2] ?? []);
                if ($site && !$error && $class === ObjectManager::class) self::configured($manager, $site);
            }],
            [$configClass, 'extend', static function ($config, array $params, string $class) use ($configClass) {
                if ($class !== $configClass) return;
                $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 4);
                if (($trace[2]['class'] ?? null) === ObjectManager::class && ($trace[2]['function'] ?? null) === 'configure'
                    && self::scopeSite($trace[3] ?? [])) {
                    self::$extended = \WeakReference::create($config);
                    return;
                }
                if ($config !== self::$config?->get()) return;
                $data = $params[0];
                // Out-of-band preference edits invalidate origin even if
                // a provider writes exactly the same mapping.
                $arguments = class_exists(DiUsage::class, false) && DiUsage::hasArgumentMeasurement();
                if (isset($data['preferences']) || (self::$compiled && (isset($data['instanceTypes']) || ($arguments && isset($data['arguments']))))
                    || array_filter($data, static fn($entry) => isset($entry['type'])
                    || isset($entry['shared']) || ($arguments && !empty($entry['arguments'])))) {
                    self::$stale ??= 'DI changed outside native area loading';
                }
            }, null],
            [$configClass, 'getPreference', null, static function ($config, array $params, $result, ?\Throwable $error, string $class) use ($configClass) {
                $index = array_key_last(self::$frames);
                if ($index === null || !isset(self::$frames[$index]) || $error || $class !== $configClass || self::$config?->get() !== $config) return;
                $frame = &self::$frames[$index];
                if ($frame['matched']) return;
                $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3);
                if (($trace[1]['file'] ?? null) !== self::$managerFile
                    || ($trace[1]['line'] ?? null) !== PreferenceManifest::LOOKUP_LINES[$frame['method']]
                    || ($trace[2]['class'] ?? null) !== ObjectManager::class
                    || ($trace[2]['function'] ?? null) !== $frame['method']) return;
                $frame['matched'] = true;
                if ($frame['route'] && $frame['route']['terminal'] !== $result) {
                    self::$stale ??= 'native lookup selected a different target';
                }
            }],
        ];
        foreach (array_keys(PreferenceManifest::LOOKUP_LINES) as $method) {
            $hooks[] = [ObjectManager::class, $method,
                static function ($manager, array $params, string $class) use ($method) {
                    if ($class !== ObjectManager::class || self::$manager?->get() !== $manager) return;
                    $requested = is_string($params[0] ?? null) ? ltrim($params[0], '\\') : '';
                    $area = self::$area;
                    $route = self::$areas[$area]['routes'][$requested] ?? null;
                    self::$frames[] = !$route && isset(self::$seen[$method]) ? null
                        : ['method' => $method, 'area' => $area, 'requested' => $requested, 'route' => $route, 'matched' => false];
                },
                static function ($manager, array $params, $result, ?\Throwable $error, string $class) use ($method) {
                    if ($class === ObjectManager::class && self::$manager?->get() === $manager) self::returned($method, $result, $error);
                }];
        }
        return class_exists(DiUsage::class, false) ? array_merge($hooks, DiUsage::hooks($areas)) : $hooks;
    }

    private static function scopeSite(array $frame): ?string
    {
        $method = [$frame['class'] ?? null, $frame['function'] ?? null];
        return match ($method) {
            [DeveloperEnvironment::class, 'configureObjectManager'], [CompiledEnvironment::class, 'configureObjectManager'] => 'bootstrap',
            [Http::class, 'launch'] => 'http',
            [StaticResource::class, 'launch'] => 'static',
            [Area::class, '_initConfig'] => 'area',
            default => null,
        };
    }

    private static function configured(ObjectManager $manager, string $site): void
    {
        $loaded = self::$loaded;
        self::$loaded = null;
        $extended = self::$extended?->get();
        self::$extended = null;
        if (!$loaded || $loaded[0] !== $site || !is_string($loaded[1])) {
            self::$broken = true;
            return;
        }
        [, $area, $delta, $arguments] = $loaded;
        $expected = self::$areas[$area] ?? null;
        self::$area = null;
        if (!$expected) {
            if (class_exists(DiUsage::class, false) && self::$manager?->get() === $manager) {
                $instance = new \ReflectionClass(ObjectManager::class);
                DiUsage::area(null, $instance->getProperty('_factory')->getValue($manager), self::$config->get());
            }
            return;
        }
        $reflection = new \ReflectionClass(ObjectManager::class);
        $config = $reflection->getProperty('_config')->getValue($manager);
        $factory = $reflection->getProperty('_factory')->getValue($manager);
        if ((!self::$global && (!PreferenceManifest::nativeHooks(self::$compiled) || $site !== 'bootstrap' || $area !== 'global'))
            || $extended !== $config || get_class($config) !== (self::$compiled ? InterceptingCompiled::class : DeveloperConfig::class)
            || get_class($factory) !== (self::$compiled ? CompiledFactory::class : DeveloperFactory::class)
            || !PreferenceManifest::nativeManager($manager)) {
            self::$broken = true;
            return;
        }
        if ($delta !== $expected['delta']) {
            self::$stale ??= 'loaded area data changed';
            return;
        }
        if (PreferenceManifest::configHash($config) !== $expected['config']) {
            self::$stale ??= 'live DI maps changed';
            return;
        }
        if (isset($expected['diUsage']['argumentDelta']) && ($arguments !== $expected['diUsage']['argumentDelta']
            || DiUsageManifest::argumentHash($config) !== $expected['diUsage']['argumentsHash'])) {
            self::$stale ??= 'constructor arguments changed';
            return;
        }
        if (class_exists(DiUsage::class, false)) DiUsage::area($area, $factory, $config, $expected['diUsage'] ?? []);
        self::$manager = \WeakReference::create($manager);
        self::$config = \WeakReference::create($config);
        self::$managerFile = $reflection->getFileName();
        self::$area = $area;
        if ($site === 'bootstrap') self::$global = true;
    }

    private static function returned(string $method, mixed $result, ?\Throwable $error): void
    {
        if (!self::$frames) {
            self::$broken = true;
            return;
        }
        $frame = array_pop(self::$frames);
        if ($frame === null) return;
        if ($frame['method'] !== $method) {
            self::$broken = true;
            return;
        }
        if ($frame['matched']) self::$seen[$method] = true;
        if ($error || !is_object($result)) return;
        $route = $frame['route'];
        if (!$route) return;
        if (!$frame['matched']) {
            self::$broken = true;
            return;
        }
        $resolved = $route['resolved'];
        if (get_class($result) !== $resolved && !is_a($result, $resolved)) {
            self::$stale ??= 'returned object differs from the effective target';
            return;
        }
        foreach ($route['ids'] as $id) Recorder::preference($id, $frame['area'], $frame['requested']);
    }

    public static function finish(): bool
    {
        if (!self::$areas) return false;
        if (self::$stale) PreferenceManifest::stale(self::$stale);
        if (self::$broken || !self::$global || self::$frames) throw new \RuntimeException('Magento preference hook did not confirm the native DI path');
        return isset(self::$seen['get'], self::$seen['create']);
    }
}
