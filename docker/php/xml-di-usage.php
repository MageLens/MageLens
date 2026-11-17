<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\Interception\ObjectManager\Config\Developer as DeveloperConfig;
use Magento\Framework\ObjectManager\Config\Compiled as CompiledConfig;
use Magento\Framework\ObjectManager\Config\Config;
use Magento\Framework\ObjectManager\Factory\AbstractFactory;
use Magento\Framework\ObjectManager\Factory\Dynamic\Developer as DeveloperFactory;
use Magento\Framework\ObjectManager\Factory\Compiled as CompiledFactory;
use Magento\Framework\ObjectManager\Relations\Runtime;

final class DiUsage
{
    private const INITIALIZER = '{closure:Magento\\Framework\\ObjectManager\\Factory\\Compiled::create():80}';
    private static array $enabled = [];
    private static array $seen = [];
    private static array $frames = [];
    private static array $context = [];
    private static array $origins = [];
    private static ?string $area = null;
    private static ?string $factoryFile = null;
    private static ?string $abstractFactoryFile = null;
    private static ?\WeakReference $factory = null;
    private static ?\WeakReference $config = null;
    private static ?DeveloperConfig $fresh = null;
    private static ?Runtime $relations = null;
    private static bool $broken = false;
    private static bool $stale = false;
    private static bool $sharedHook = false;
    private static bool $compiled = false;
    private static bool $compiledPreferences = false;
    private static ?\WeakMap $lazy = null;

    public static function hooks(array $areas): array
    {
        foreach ($areas as $area) {
            self::$enabled += $area['diUsage']['eligible'] ?? [];
            self::$compiledPreferences = self::$compiledPreferences || !empty($area['diUsage']['preferences']);
        }
        if (!self::$enabled && !self::$compiledPreferences) return [];
        $compiled = $areas['global']['compiled'] ?? false;
        self::$compiled = $compiled;
        $factoryClass = $compiled ? CompiledFactory::class : DeveloperFactory::class;
        $configClass = $compiled ? CompiledConfig::class : DeveloperConfig::class;
        if (($areas['global']['lazyCompiled'] ?? false) && self::hasArgumentMeasurement()) self::$lazy = new \WeakMap();
        $hooks = [
            [$factoryClass, 'create',
                static function ($factory, array $params, string $class) use ($factoryClass) {
                    if ($class !== $factoryClass || self::$factory?->get() !== $factory) return;
                    $type = $params[0] ?? null;
                    $route = is_string($type) ? (self::$context['virtualRoutes'][$type] ?? null) : null;
                    self::$frames[] = self::frame($type, $route, self::$compiled ? ($params[1] ?? []) : []);
                },
                static function ($factory, array $params, $result, ?\Throwable $error, string $class) use ($factoryClass) {
                    if ($class !== $factoryClass || self::$factory?->get() !== $factory) return;
                    if (self::$lazy !== null && !$error && is_object($result)
                        && (new \ReflectionClass($result))->isUninitializedLazyObject($result)
                        && is_string($params[0] ?? null)) {
                        self::$lazy[$result] = $params[0];
                    }
                    self::returned($result, $error);
                }],
        ];
        if (isset(self::$enabled['virtual-types'])) {
            $hooks[] = [$configClass, 'getInstanceType', null,
                static function ($config, array $params, $result, ?\Throwable $error, string $class) use ($configClass, $factoryClass, $compiled) {
                    $index = array_key_last(self::$frames);
                    if ($index === null || $class !== $configClass || $error || self::$config?->get() !== $config) return;
                    $frame = &self::$frames[$index];
                    if ($frame['lookedUp'] || (!$frame['virtual'] && isset(self::$seen['virtual-types']))) return;
                    $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3);
                    if (!self::site($trace, $compiled ? [56, 64] : [49], 'create', $factoryClass)) return;
                    $frame['lookedUp'] = true;
                    self::$seen['virtual-types'] = true;
                    $expected = $frame['virtual']['resolved'] ?? null;
                    if ($expected !== null && $result !== $expected && $result !== $expected . '\\Interceptor') self::$stale = true;
                }];
        }
        if ($compiled) {
            if (self::hasArgumentMeasurement()) {
                $hooks[] = [CompiledConfig::class, 'getArguments', null,
                    static function ($config, array $params, $result, ?\Throwable $error, string $class) {
                        $index = array_key_last(self::$frames);
                        if ($index === null || $error || $class !== CompiledConfig::class || self::$config?->get() !== $config) return;
                        $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3);
                        $line = self::$lazy !== null ? 104 : 55;
                        $method = self::$lazy !== null ? 'resolveArguments' : 'create';
                        if ($params[0] !== self::$frames[$index]['requested'] || !self::site($trace, [$line], $method, CompiledFactory::class)) return;
                        if (is_array($result)) self::compiledArguments(self::$frames[$index], $result);
                    }];
                if (self::$lazy !== null) {
                    $hooks[] = [CompiledFactory::class, self::INITIALIZER,
                        static function ($factory, array $params) {
                            if (self::$factory?->get() !== $factory) return;
                            $object = $params[0];
                            $requested = self::$lazy[$object] ?? null;
                            if ($requested !== null && self::$config->get()->getInstanceType($requested) !== get_class($object)) $requested = null;
                            self::$frames[] = self::frame($requested);
                        },
                        static function ($factory, array $params, $result, ?\Throwable $error) {
                            if (self::$factory?->get() !== $factory) return;
                            if (!$error) unset(self::$lazy[$params[0]]);
                            self::returned($params[0], $error);
                        }];
                }
            }
            return $hooks;
        }
        if (self::hasArgumentMeasurement()) {
            $hooks[] = [AbstractFactory::class, 'setArguments', static function ($factory) {
                if (self::$frames && self::$factory?->get() === $factory) self::$stale = true;
            }, null];
            $hooks[] = [DeveloperFactory::class, '_resolveArguments',
                static function ($factory, array $params, string $class) {
                    $index = array_key_last(self::$frames);
                    if ($index === null || $class !== DeveloperFactory::class || self::$factory?->get() !== $factory) return;
                    $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3);
                    if (!self::site($trace, [61], 'create')) return;
                    self::$frames[$index]['constructor'] = array_column($params[1], null, 0);
                    foreach ($params[2] ?? [] as $name => $value) unset(self::$frames[$index]['constructor'][$name]);
                }, null];
            $hooks[] = [Config::class, 'getArguments', null,
                static function ($config, array $params, $result, ?\Throwable $error, string $class) {
                    $index = array_key_last(self::$frames);
                    if ($index === null || $class !== Config::class || $error || self::$config?->get() !== $config || !is_array($result)) return;
                    $frame = &self::$frames[$index];
                    if ($frame['constructor'] === null || $frame['read']) return;
                    $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3);
                    if (!self::site($trace, [27], '_resolveArguments')) return;
                    $frame['read'] = true;
                    foreach (['arguments', 'lifecycles'] as $family) if (isset(self::$enabled[$family])) self::$seen[$family] = true;
                    $candidates = array_intersect_key($frame['constructor'], self::$context['names'] ?? []);
                    if (!$candidates || !is_string($frame['requested']) || !self::$fresh) return;
                    if (self::$area !== $frame['area']) {
                        self::$broken = true;
                        return;
                    }
                    $type = $frame['requested'];
                    $arguments = array_intersect_key(self::argumentOrigins($type), $candidates);
                    if (!$arguments) return;
                    $expected = array_intersect_key(self::$fresh->getArguments($type), $arguments);
                    if (count($expected) !== count($arguments) || array_intersect_key($result, $arguments) !== $expected) {
                        self::$stale = true;
                        return;
                    }
                    $factory = self::$factory->get();
                    $initial = (new \ReflectionProperty(AbstractFactory::class, 'globalArguments'))->getValue($factory);
                    foreach ($arguments as $name => $entry) {
                        [, $paramType, , $default, $variadic] = $candidates[$name];
                        $object = !$variadic && $paramType && $result[$name] !== $default;
                        self::applied($entry, $result[$name], $initial, $frame, !$variadic && !$object, $object);
                    }
                }];
        }
        if (isset(self::$enabled['lifecycles'])) {
            $hooks[] = [Config::class, 'isShared', null,
                static function ($config, array $params, $result, ?\Throwable $error, string $class) {
                    if ($class !== Config::class || $error || self::$config?->get() !== $config) return;
                    self::$sharedHook = true;
                    $index = array_key_last(self::$frames);
                    if ($index === null) return;
                    $type = $params[0] ?? null;
                    $policy = is_string($type) ? (self::$context['shared'][$type] ?? null) : null;
                    if (!$policy) return;
                    $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3);
                    if (($trace[1]['file'] ?? null) !== self::$abstractFactoryFile
                        || !in_array([$trace[1]['line'] ?? null, $trace[2]['function'] ?? null],
                            [[171, 'resolveArgument'], [207, 'parseArray']], true)) return;
                    if (self::$frames[$index]['area'] !== self::$area) {
                        self::$broken = true;
                    } elseif ($result !== $policy['shared']) {
                        self::$stale = true;
                    } else {
                        self::$frames[$index]['lifetimes'][] = $policy['id'];
                    }
                }];
        }
        return $hooks;
    }

    private static function frame(mixed $type, ?array $route = null, array $arguments = []): array
    {
        return ['requested' => $type, 'area' => self::$area, 'virtual' => $route, 'lookedUp' => false,
            'constructor' => null, 'read' => false, 'arguments' => [], 'lifetimes' => [], 'preferences' => [],
            'overrides' => array_fill_keys(array_keys(array_filter($arguments, static fn($value) => $value !== null)), true)];
    }

    private static function site(array $trace, array $lines, string $method, string $factory = DeveloperFactory::class): bool
    {
        return ($trace[1]['file'] ?? null) === self::$factoryFile && in_array($trace[1]['line'] ?? null, $lines, true)
            && ($trace[2]['class'] ?? null) === $factory && ($trace[2]['function'] ?? null) === $method;
    }

    public static function hasArgumentMeasurement(): bool
    {
        return self::$compiledPreferences || isset(self::$enabled['arguments']) || isset(self::$enabled['lifecycles']);
    }

    private static function applied(array $entry, mixed $value, array $initial, array &$frame, bool $runtimeArray, bool $object): void
    {
        if (($entry['kind'] ?? null) === 'init_parameter'
            && (!$runtimeArray || !is_array($value) || !isset($value['argument'], $initial[$value['argument']]))) return;
        if ($entry['id'] !== null) $frame['arguments'][] = $entry['id'];
        if (is_string($entry['shared'] ?? null) && $object && is_array($value) && isset($value['instance'], $value['shared'])) {
            $frame['lifetimes'][] = $entry['shared'];
        }
        if (!($entry['items'] ?? []) || !$runtimeArray || !is_array($value) || isset($value['instance']) || isset($value['argument'])) return;
        foreach (array_intersect_key($entry['items'], $value) as $key => $item) {
            $descriptor = is_array($value[$key]) && isset($value[$key]['instance']);
            self::applied($item, $value[$key], $initial, $frame, !$descriptor, $descriptor);
        }
    }

    private static function compiledArguments(array &$frame, array $arguments): void
    {
        foreach (['arguments', 'lifecycles'] as $family) if (isset(self::$enabled[$family])) self::$seen[$family] = true;
        if (!is_string($frame['requested']) || $frame['area'] === null || !$arguments) return;
        $type = self::sourceType($frame['requested']);
        $arguments = array_diff_key($arguments, $frame['overrides']);
        $named = array_intersect_key($arguments, self::$context['names'] ?? []);
        $origins = $named ? array_intersect_key(self::argumentOrigins($type), $named) : [];
        // The compiler selects top-level configuration with isset(). Nested
        // null array items survive compilation and are handled by compiledEntry.
        $origins = array_filter($origins, static fn($entry) => empty($entry['null']));
        $initial = (new \ReflectionProperty(AbstractFactory::class, 'globalArguments'))->getValue(self::$factory->get());
        foreach ($origins as $name => $entry) self::compiledEntry($entry, $arguments[$name], $initial, $frame, true);
        $targets = self::$context['dependencyTargets'] ?? [];
        $implicit = array_filter(array_diff_key($arguments, $origins), static fn($entry) => is_array($entry)
            && isset($targets[$entry['_i_'] ?? $entry['_ins_'] ?? '']));
        if ($implicit) {
            $resolved = self::$context['virtual'][$type] ?? $type;
            [, $resolved] = DiUsageManifest::virtualPath($resolved, self::$context['virtual']);
            foreach (self::$factory->get()->getDefinitions()->getParameters($resolved) ?? [] as [$name, $requested]) {
                if (!$requested || !isset($implicit[$name])) continue;
                self::compiledDependency($requested, $implicit[$name], $frame, true);
            }
        }
    }

    private static function compiledEntry(array $entry, mixed $value, array $initial, array &$frame, bool $parameter): void
    {
        if ($entry['kind'] === 'init_parameter'
            && (!is_array($value) || !isset($value['_a_'], $initial[$value['_a_']]))) return;
        if ($entry['id'] !== null) $frame['arguments'][] = $entry['id'];
        if ($entry['objectType'] !== null) {
            if (is_string($entry['shared']) && is_array($value) && (isset($value['_i_']) || isset($value['_ins_']))) {
                $frame['lifetimes'][] = $entry['shared'];
            }
            self::compiledDependency(ltrim($entry['objectType'], '\\'), $value, $frame, $entry['shared'] === null);
        }
        if ($parameter) $value = is_array($value) ? ($value['_vac_'] ?? $value['_v_'] ?? null) : null;
        if (!is_array($value)) return;
        foreach (array_intersect_key($entry['items'], $value) as $key => $item) self::compiledEntry($item, $value[$key], $initial, $frame, false);
    }

    private static function compiledDependency(string $requested, mixed $descriptor, array &$frame, bool $typeLifetime): void
    {
        if (!is_array($descriptor)) return;
        $route = self::$context['preferences'][$requested] ?? null;
        if ($route && ($descriptor['_i_'] ?? $descriptor['_ins_'] ?? null) === $route['terminal']) {
            foreach ($route['ids'] as $id) $frame['preferences'][] = [$id, $requested];
        }
        if (!$typeLifetime) return;
        $policy = self::$context['shared'][$requested] ?? null;
        if (!$policy) return;
        if (isset($descriptor[$policy['shared'] ? '_i_' : '_ins_'])) $frame['lifetimes'][] = $policy['id'];
    }

    private static function sourceType(string $type): string
    {
        return str_ends_with($type, '\\Interceptor') ? substr($type, 0, -12) : $type;
    }

    private static function mergeEntries(array $older, array $newer): array
    {
        if (!$older['array'] || !$newer['array']) return $newer;
        if (($older['kind'] ?? null) === 'object' && ($newer['kind'] ?? null) === 'object') {
            $retained = array_diff_key($older['objectFields'], $newer['objectFields']);
            if ($retained && $older['id'] !== $newer['id']) $newer['id'] = null;
            $newer['objectFields'] += $retained;
            // False denotes an explicit setting with no eligible in-scope owner.
            $newer['shared'] ??= $older['shared'];
            return $newer;
        }
        if ($older['id'] !== $newer['id']) $newer['id'] = null;
        if (($older['kind'] ?? null) !== 'array' || ($newer['kind'] ?? null) !== 'array') {
            $newer['items'] = [];
            return $newer;
        }
        $items = $older['items'];
        foreach ($newer['items'] as $key => $entry) {
            $items[$key] = isset($items[$key]) ? self::mergeEntries($items[$key], $entry) : $entry;
        }
        $newer['items'] = $items;
        return $newer;
    }

    public static function area(?string $area, object $factory, DeveloperConfig|CompiledConfig $config, array $expected = []): void
    {
        if (!self::$enabled && !self::$compiledPreferences) return;
        self::$area = $area;
        self::$context = $expected;
        self::$origins = [];
        self::$fresh = self::$relations = null;
        self::$factoryFile ??= (new \ReflectionClass($factory))->getFileName();
        self::$abstractFactoryFile ??= (new \ReflectionClass(AbstractFactory::class))->getFileName();
        self::$factory = \WeakReference::create($factory);
        self::$config = \WeakReference::create($config);
        if (self::$compiled) {
            self::$relations = new Runtime();
            $targets = [];
            foreach ($expected['preferences'] ?? [] as $route) $targets[$route['terminal']] = true;
            foreach ($expected['shared'] ?? [] as $type => $policy) $targets[$config->getPreference($type)] = true;
            self::$context['dependencyTargets'] = $targets;
            return;
        }
        if (isset(self::$enabled['lifecycles']) && !self::$sharedHook) {
            // The isolated query verifies hook entry even on a zero-hit request.
            $config->isShared(array_key_first($expected['shared'] ?? []) ?? '');
        }
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
            $owners[$name] = isset($owners[$name]) ? self::mergeEntries($owners[$name], $entry) : $entry;
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
        foreach (array_unique($frame['lifetimes']) as $id) Recorder::diUsage($id, 'lifetime-applied', $frame['area'], $frame['requested']);
        foreach ($frame['preferences'] as [$id, $requested]) Recorder::preference($id, $frame['area'], $requested);
    }

    public static function finish(): array
    {
        if (self::$stale) PreferenceManifest::stale('factory DI differs from its prepared configuration');
        if (self::$broken || self::$frames || (!self::$compiled && isset(self::$enabled['lifecycles']) && !self::$sharedHook)) {
            throw new \RuntimeException('Magento DI usage hooks did not confirm the configured factory path');
        }
        return self::$seen;
    }
}
