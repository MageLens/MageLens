<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\Config\ScopeInterface;
use Magento\Framework\Interception\{DefinitionInterface, Interceptor};
use Magento\Framework\Interception\PluginList\PluginList;

final class Plugins
{
    // Both pinned platforms have the same trait bytes and executable call sites.
    private const TRAIT_HASH = '2139b5d396906f0eebba878c428afd74777235c835fb3680cfd608a5f610f1a4';
    private const LOOKUP = [119 => 'before', 133 => 'around', 144 => 'after'];
    private const CALL = ['before' => 121, 'around' => 135, 'after' => 146];
    private const PROBE = __NAMESPACE__ . '\\PluginHookProbe';
    private const PROBE_BODY = __NAMESPACE__ . '\\PluginHookProbeBody';
    private static array $targets = [];
    private static array $types = [];
    private static array $inline = [];
    private static array $inlineMethods = [];
    private static array $inlineFiles = [];
    private static array $dispatches = [];
    private static array $validated = [];
    private static array $errors = [];
    private static array $bodies = [];
    private static array $ambiguous = [];
    private static ?PluginList $list = null;
    private static $scope = null;
    private static ?string $trait = null;
    private static bool $validating = false;
    private static ?object $probe = null;
    private static int $probeHits = 0;
    private static bool $probeNext = false;

    public static function hooks(array $targets): array
    {
        if (!$targets) return [];
        self::$targets = $targets;
        $methods = [self::PROBE_BODY => ['beforeRun' => true]];
        $subjects = [self::PROBE => true];
        $inlineGetters = [];
        foreach ($targets as $subjectsInArea) foreach ($subjectsInArea as $subject => $entry) {
            $wrapper = $subject . '\\Interceptor';
            if (isset($entry['inline'])) {
                self::$inline[$wrapper] = $entry['inline'];
                foreach ($entry['inline']['sites'] as $site) {
                    if (!isset($entry['targets'][$site['name']][$site['method']][$site['phase']])) continue;
                    self::$inlineMethods[$wrapper][$site['method']] = true;
                    $inlineGetters[$wrapper][$site['getter']] = true;
                }
            } else {
                self::$types[$subject] = true;
                $subjects[$wrapper] = true;
            }
            foreach ($entry['targets'] as $registration) foreach ($registration as $phases) foreach ($phases as $target) {
                $methods[$target['class']][$target['callback']] = true;
            }
        }
        $hooks = [
            [PluginList::class, 'getNext', null, static function ($list, array $args, $result, ?\Throwable $error, string $class) {
                if ($error || self::$validating || $class !== PluginList::class) return;
                if ($list === self::$probe) self::$probeNext = true;
                elseif (isset(self::$types[$args[0]])) self::validate($list);
            }],
            [PluginList::class, 'getPlugin', null, static function ($list, array $args, $object, ?\Throwable $error, string $class) {
                if (!$error && $class === PluginList::class && (isset(self::$types[$args[0]]) || $list === self::$probe)) {
                    self::lookup($list, (string) $args[0], (string) $args[1], $object);
                }
            }],
        ];
        foreach ($subjects as $class => $unused) {
            $hooks[] = [$class, '___callPlugins',
                static function ($object, array $args, string $declaring) use ($class) {
                    if ($declaring === $class) self::enter($object, $args[0]);
                },
                self::leaveHook($class)];
        }
        foreach (self::$inline as $class => $unused) {
            foreach (array_keys(self::$inlineMethods[$class] ?? []) as $method) {
                $hooks[] = [$class, $method,
                    static function ($object, array $args, string $declaring) use ($class, $method) {
                        if ($declaring === $class) self::enter($object, $method);
                    },
                    self::leaveHook($class)];
            }
            foreach (array_keys($inlineGetters[$class] ?? []) as $getter) {
                $hooks[] = [$class, $getter, null,
                    static function ($object, array $args, $plugin, ?\Throwable $error, string $declaring) use ($class, $getter) {
                        if (!$error && $declaring === $class) self::lookupInline($object, $getter, $plugin);
                    }];
            }
        }
        foreach ($methods as $class => $callbacks) foreach ($callbacks as $method => $unused) {
            $hooks[] = [$class, $method,
                static function ($object, array $args, string $declaring) use ($class, $method) {
                    if ($declaring === $class) self::begin($object, $class, $method);
                },
                static function ($object, array $args, $result, ?\Throwable $error, string $declaring) use ($class, $method) {
                    if ($declaring === $class) self::end($class, $method, $error);
                }];
        }
        return $hooks;
    }

    private static function leaveHook(string $class): \Closure
    {
        return static function ($object, array $args, $result, ?\Throwable $error, string $declaring) use ($class) {
            if ($declaring === $class) self::leave($object, $error);
        };
    }

    private static function validate(PluginList $list): void
    {
        self::$validating = true;
        try {
            if (self::$list !== $list) {
                self::$list = $list;
                self::$scope = PluginManifest::property($list, '_configScope');
                self::$validated = [];
            }
            $area = self::$scope->getCurrentScope();
            if (isset(self::$validated[$area]) || !isset(self::$targets[$area])) return;
            PluginManifest::validateList($list, self::$targets[$area], array_map(
                static fn(string $name) => PluginManifest::property($list, $name),
                ['_data', '_inherited', '_processed']
            ));
            self::$validated[$area] = true;
        } catch (\Throwable) {
            self::$errors['Runtime Magento plugin registrations or chains differ from current XML provenance; use --refresh-cache'] = true;
        } finally {
            self::$validating = false;
        }
    }

    private static function enter(object $object, string $method): void
    {
        $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS | DEBUG_BACKTRACE_PROVIDE_OBJECT);
        $depth = count($trace) - 2;
        $frame = ['object' => $object, 'method' => $method, 'pending' => []];
        $class = get_class($object);
        if (isset(self::$inline[$class])) {
            try {
                $frame['area'] = self::inlineScope($class)->getValue($object)->getCurrentScope();
            } catch (\Throwable) {
                self::$errors['Generated plugin interceptor differs from XML provenance; regenerate Magento interceptors'] = true;
            }
        }
        self::$dispatches[$depth] = $frame;
    }

    private static function inlineScope(string $class): \ReflectionProperty
    {
        static $wrappers = [];
        if (isset($wrappers[$class])) return $wrappers[$class];
        $file = (new \ReflectionClass($class))->getFileName();
        $expected = self::$inline[$class];
        if (InlinePluginManifest::hash(file_get_contents($file)) !== $expected['hash']) {
            throw new \RuntimeException();
        }
        self::$inlineFiles[$file] = $expected['sites'];
        return $wrappers[$class] = new \ReflectionProperty($class, '____scope');
    }

    private static function leave(object $object, ?\Throwable $error): void
    {
        $depth = array_key_last(self::$dispatches);
        $frame = self::$dispatches[$depth] ?? null;
        if (!$frame || $frame['object'] !== $object) {
            self::$errors['Unbalanced native plugin dispatch hooks'] = true;
            return;
        }
        unset(self::$dispatches[$depth]);
        if ($error) return;
        foreach ($frame['pending'] as $entry) {
            if (!$entry['entered'] && !$entry['wrapped']) self::$errors['Native plugin callback hook was bypassed'] = true;
        }
    }

    private static function traitFile(): string
    {
        if (self::$trait === null) {
            $file = (new \ReflectionMethod(Interceptor::class, '___callPlugins'))->getFileName();
            if (hash('sha256', str_replace("\r\n", "\n", file_get_contents($file))) !== self::TRAIT_HASH) {
                throw new \RuntimeException('Unsupported Magento interceptor trait for plugin coverage');
            }
            self::$trait = $file;
        }
        return self::$trait;
    }

    private static function trace(): array
    {
        // Skip this helper, the hook handler and OpenTelemetry's closure.
        return array_slice(debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS | DEBUG_BACKTRACE_PROVIDE_OBJECT), 3);
    }

    private static function closure(array $frame): bool
    {
        return str_starts_with($frame['function'] ?? '', '{closure:' . Interceptor::class . '::___callPlugins():');
    }

    private static function generatorAround(array $frame): bool
    {
        $class = $frame['class'] ?? null;
        $method = $frame['function'];
        if ($class === null || !str_starts_with(strtolower($method), 'around')) return false;
        static $generators = [];
        return $generators[$class][$method] ??= method_exists($class, $method)
            && (new \ReflectionMethod($class, $method))->isGenerator();
    }

    private static function dispatch(array $trace, int $index, string $method = '___callPlugins'): ?int
    {
        if ($method === '___callPlugins' && !self::closure($trace[$index] ?? [])) return null;
        $object = $trace[$index]['object'] ?? null;
        if (!$object) return null;
        for ($i = $index, $size = count($trace); $i < $size; $i++) {
            $frame = $trace[$i];
            if (($frame['object'] ?? null) === $object && $frame['function'] === $method) return $i;
            // Iteration may happen during an unrelated invocation on the same
            // object. A resumed around callback cannot inherit that frame.
            if (self::generatorAround($frame)) return null;
        }
        return null;
    }

    private static function lookup(PluginList $list, string $subject, string $name, mixed $object): void
    {
        try {
            $area = $list === self::$probe ? 'probe'
                : PluginManifest::property($list, '_configScope')->getCurrentScope();
            $registrations = $area === 'probe' ? [] : (self::$targets[$area][$subject]['targets'][$name] ?? []);
            if (!$registrations && $area !== 'probe') return;
            $trace = self::trace();
            $trait = self::traitFile();
            $phase = ($trace[0]['file'] ?? null) === $trait ? (self::LOOKUP[$trace[0]['line']] ?? null) : null;
            if (!$phase) return;
            $index = self::dispatch($trace, 1);
            // Magento's proceed closure can outlive its dispatch. Deferred
            // calls have no live frame to bind and are unmeasured.
            if ($index === null) return;
            $depth = self::dispatchDepth($trace, $index) ?? throw new \RuntimeException();
            $method = self::$dispatches[$depth]['method'];
            $target = $area === 'probe'
                ? ['id' => '', 'implementation' => self::PROBE_BODY, 'class' => self::PROBE_BODY, 'callback' => 'beforeRun']
                : ($registrations[$method][$phase] ?? null);
            if (!$target) return;
            if ($area !== 'probe' && ($list !== self::$list || empty(self::$validated[$area]))) throw new \RuntimeException();
            self::bind($depth, count($trace) - 1, $target, $object, $area, $subject, $name, $method, $phase, $trait, self::CALL[$phase]);
        } catch (\Throwable) {
            self::$errors['Cannot bind native Magento plugin lookup to prepared provenance'] = true;
        }
    }

    private static function dispatchDepth(array $trace, int $index): ?int
    {
        $depth = count($trace) - $index;
        return (self::$dispatches[$depth]['object'] ?? null) === $trace[$index]['object'] ? $depth : null;
    }

    private static function lookupInline(object $owner, string $getter, mixed $object): void
    {
        try {
            $trace = self::trace();
            $file = $trace[0]['file'] ?? '';
            $line = $trace[0]['line'] ?? 0;
            if (!isset(self::$inlineFiles[$file])) self::inlineScope(get_class($owner));
            $site = self::$inlineFiles[$file][$line] ?? null;
            if (!$site || $site['getter'] !== $getter || ($trace[1]['object'] ?? null) !== $owner
                || !isset(self::$inlineMethods[get_class($owner)][$site['method']])) return;
            $index = self::dispatch($trace, 1, $site['method']);
            if ($index === null) return;
            $depth = self::dispatchDepth($trace, $index) ?? throw new \RuntimeException();
            $area = self::$dispatches[$depth]['area'] ?? '';
            $subject = get_parent_class($owner);
            ['name' => $name, 'method' => $method, 'phase' => $phase] = $site;
            $target = self::$targets[$area][$subject]['targets'][$name][$method][$phase] ?? null;
            if ($target) self::bind($depth, count($trace) - 1, $target, $object, $area, $subject, $name, $method, $phase, $file, $line);
        } catch (\Throwable) {
            self::$errors['Cannot bind native Magento plugin lookup to prepared provenance'] = true;
        }
    }

    private static function bind(int $depth, int $caller, array $target, mixed $object, string $area,
        string $subject, string $name, string $method, string $phase, string $file, int $line): void
    {
        $type = is_object($object) ? get_class($object) : '';
        $wrapped = $type === $target['implementation'] . '\\Interceptor' && is_a($object, $target['implementation']);
        if (!$wrapped && $type !== $target['implementation']) throw new \RuntimeException();
        $previous = self::$dispatches[$depth]['pending'][$caller] ?? null;
        if ($previous && !$previous['entered'] && !$previous['wrapped']) {
            self::$errors['Native plugin callback hook was bypassed'] = true;
        }
        self::$dispatches[$depth]['pending'][$caller] = $target + [
            'object' => $object, 'wrapped' => $wrapped, 'entered' => false, 'area' => $area,
            'identity' => ['subject' => $subject, 'method' => $method, 'phase' => $phase],
            'name' => $name, 'file' => $file, 'line' => $line,
        ];
    }

    private static function isInlineSite(array $frame): bool
    {
        return isset(self::$inlineFiles[$frame['file'] ?? ''][$frame['line'] ?? 0]);
    }

    private static function bodyCall(array $trace, object $object, string $method): ?int
    {
        $trait = self::traitFile();
        if ((($trace[0]['file'] ?? null) === $trait && in_array($trace[0]['line'], self::CALL, true))
            || self::isInlineSite($trace[0])) return 0;
        $wrapper = get_class($object);
        if (!str_ends_with($wrapper, '\\Interceptor')) return null;
        if (($trace[1]['class'] ?? null) === $wrapper && $trace[1]['function'] === $method) {
            // Generated wrapper's direct parent path when it has no plugins.
            $generated = new \ReflectionMethod($wrapper, $method);
            if (($trace[0]['file'] ?? null) === $generated->getFileName()
                && $trace[0]['line'] >= $generated->getStartLine() && $trace[0]['line'] <= $generated->getEndLine()) return 1;
        }
        if (($trace[1]['class'] ?? null) === $wrapper && str_starts_with($trace[1]['function'], '{closure:' . $wrapper . '::' . $method . '():')) {
            $generated = new \ReflectionMethod($wrapper, $method);
            if (($trace[0]['file'] ?? null) === $generated->getFileName()
                && $trace[0]['line'] >= $generated->getStartLine() && $trace[0]['line'] <= $generated->getEndLine()) {
                for ($i = 2, $size = count($trace); $i < $size; $i++) {
                    if (($trace[$i]['object'] ?? null) === $object && $trace[$i]['function'] === $method) return $i;
                }
            }
        }
        if (($trace[0]['file'] ?? null) !== $trait || $trace[0]['line'] !== 58
            || ($trace[1]['file'] ?? null) !== $trait || $trace[1]['line'] !== 138
            || $trace[1]['function'] !== '___callParent' || !self::closure($trace[2] ?? [])) return null;
        // The original plugin method was reached through its own chain. Find
        // the wrapper which started that chain, including nested proceed calls.
        for ($i = 3, $size = count($trace); $i < $size - 1; $i++) {
            if (($trace[$i]['object'] ?? null) !== $object || $trace[$i]['function'] !== '___callPlugins') continue;
            $caller = $trace[$i + 1];
            return ($caller['object'] ?? null) === $object && $caller['class'] === $wrapper && $caller['function'] === $method
                ? $i + 1 : null;
        }
        return null;
    }

    private static function begin(object $object, string $class, string $method): void
    {
        $entry = null;
        try {
            if (!self::$dispatches) return;
            $trace = self::trace();
            $call = self::bodyCall($trace, $object, $method);
            if ($call !== null) {
                $frame = $trace[$call];
                $file = $frame['file'] ?? '';
                $line = $frame['line'] ?? 0;
                $site = self::$inlineFiles[$file][$line] ?? null;
                $index = $site ? self::dispatch($trace, $call + 1, $site['method'])
                    : ($file === self::traitFile() ? self::dispatch($trace, $call + 1) : null);
                if ($index === null) return;
                $depth = self::dispatchDepth($trace, $index);
                if ($depth === null) return;
                $closure = count($trace) - $call - 1;
                $dispatch = self::$dispatches[$depth];
                $candidate = $dispatch['pending'][$closure] ?? null;
                if (!$candidate && $site) {
                    $area = $dispatch['area'] ?? '';
                    $subject = get_parent_class($dispatch['object']);
                    if (isset(self::$targets[$area][$subject]['targets'][$site['name']][$site['method']][$site['phase']])) {
                        self::$errors['Native generated plugin getter hook was bypassed'] = true;
                    }
                }
                if ($candidate && $candidate['object'] === $object && $candidate['class'] === $class
                    && $candidate['callback'] === $method && $candidate['file'] === $file && $candidate['line'] === $line) {
                    self::$dispatches[$depth]['pending'][$closure]['entered'] = true;
                    $entry = $candidate;
                }
            }
        } catch (\Throwable) {
            self::$errors['Cannot attribute native Magento plugin callback entry'] = true;
        } finally {
            self::$bodies[] = $entry;
        }
    }

    private static function end(string $class, string $method, ?\Throwable $error): void
    {
        $entry = array_pop(self::$bodies);
        if (!$entry) return;
        if ($entry['area'] === 'probe') {
            self::$probeHits++;
            return;
        }
        if ($error instanceof \TypeError) {
            $body = new \ReflectionMethod($class, $method);
            // The observer pre-hook runs ahead of PHP's parameter validation.
            // A TypeError at the declaration cannot establish body execution.
            if ($error->getFile() === $body->getFileName() && $error->getLine() === $body->getStartLine()) {
                self::$ambiguous[$entry['id']][$entry['area']][PluginManifest::callbackKey($entry['identity'])] = true;
                return;
            }
        }
        Recorder::plugin($entry['id'], $entry['area'], $entry['name'], $entry['identity']);
    }

    public static function finish(): array
    {
        if (!self::$targets) return [false, []];
        if (self::$dispatches || self::$bodies) self::$errors['Unbalanced native plugin callback context'] = true;
        if (self::$errors) throw new \RuntimeException(implode('. ', array_keys(self::$errors)));
        require_once __DIR__ . '/xml-plugin-probe.php';
        $list = (new \ReflectionClass(PluginList::class))->newInstanceWithoutConstructor();
        $plugin = new PluginHookProbeBody();
        $scope = new class implements ScopeInterface {
            public function getCurrentScope() { return 'probe'; }
            public function setCurrentScope($scope) {}
        };
        foreach (['_configScope' => $scope, '_loadedScopes' => ['probe' => true], '_inherited' => [self::PROBE => []],
            '_processed' => [self::PROBE . '_run___self' => [DefinitionInterface::LISTENER_BEFORE => ['probe']]],
            '_pluginInstances' => [self::PROBE => ['probe' => $plugin]],
        ] as $name => $value) (new \ReflectionProperty(PluginList::class, $name))->setValue($list, $value);
        self::$probe = $list;
        self::$probeHits = 0;
        self::$probeNext = false;
        try {
            (new PluginHookProbe($list))->run();
            if (!self::$probeNext || self::$probeHits !== 1 || self::$dispatches || self::$bodies || self::$errors) {
                throw new \RuntimeException('Native plugin execution hooks failed their self-check');
            }
        } finally {
            self::$probe = null;
        }
        return [true, self::$ambiguous];
    }
}
