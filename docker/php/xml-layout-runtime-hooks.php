<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

final class LayoutRuntimeHooks
{
    private static bool $failed = false;
    private static int $depth = 0;
    private static string $failureLocation = '';
    private static array $internal = [];
    private static int $internalCallbacks = 0;
    private static array $internalObserved = [];

    private function __construct(private readonly \Closure $callback) {}

    public static function wrap(?\Closure $callback): ?\Closure
    {
        return $callback === null ? null : (new self($callback))->__invoke(...);
    }

    public static function register(string $class, string $method, ?\Closure $pre, ?\Closure $post): bool
    {
        return self::registerWrapped($class, $method, self::wrap($pre), self::wrap($post));
    }

    public static function registerWrapped(string $class, string $method, ?\Closure $pre, ?\Closure $post): bool
    {
        $key = $class . '::' . $method;
        if (array_key_exists($key, self::$internal)) {
            if (++self::$internalCallbacks > 1024) throw new \RuntimeException('Internal layout hook subscribers exceeded 1024 callbacks');
            self::$internal[$key][] = [$pre, $post];
            return true;
        }
        return \OpenTelemetry\Instrumentation\hook($class, $method, $pre, $post);
    }

    /** Install before application bootstrap; subscribers may be attached later. */
    public static function primeInternals(): void
    {
        foreach ([\Closure::class => ['bind', 'bindTo', 'call'],
            \ReflectionProperty::class => ['setValue', 'setRawValue', 'setRawValueWithoutLazyInitialization']] as $class => $methods) {
            foreach ($methods as $method) {
                $key = $class . '::' . $method;
                if (array_key_exists($key, self::$internal)) continue;
                self::$internal[$key] = [];
                if (!\OpenTelemetry\Instrumentation\hook($class, $method,
                    static function (...$params) use ($key): void {
                        self::$internalObserved[$key]['pre'] = true;
                        foreach (self::$internal[$key] as [$pre]) if ($pre !== null) $pre(...$params);
                    },
                    static function (...$params) use ($key): void {
                        self::$internalObserved[$key]['post'] = true;
                        foreach (array_reverse(self::$internal[$key]) as [, $post]) if ($post !== null) $post(...$params);
                    })) throw new \RuntimeException('Cannot initialize native internal layout hooks');
            }
        }
        $receiver = new class { public int $value = 0; };
        $closure = function (): void {};
        \Closure::bind($closure, null, null);
        $closure->bindTo(null, null);
        $closure->call($receiver);
        $property = new \ReflectionProperty($receiver, 'value');
        foreach (['setValue', 'setRawValue', 'setRawValueWithoutLazyInitialization'] as $method) $property->$method($receiver, 0);
        foreach (array_keys(self::$internal) as $key) {
            if ((self::$internalObserved[$key] ?? []) !== ['pre' => true, 'post' => true]) {
                throw new \RuntimeException('Missing native internal layout hook evidence; register before application bootstrap');
            }
        }
    }

    public function __invoke(...$params): void
    {
        if (self::$failed) return;
        if (self::$depth >= 512) {
            self::$failed = true;
            return;
        }
        self::$depth++;
        try {
            // A void return type tells the extension to preserve the native
            // result. Returning null with a mixed type replaces that result.
            ($this->callback)(...$params);
        } catch (\Throwable $error) {
            // The extension catches callback errors itself, emits their private
            // messages and continues. Retain failure health and collector code
            // metadata, never exception text or application values.
            self::$failed = true;
            $callback = new \ReflectionFunction($this->callback);
            $file = $callback->getFileName();
            if (is_string($file) && dirname($file) === __DIR__ && preg_match('/^xml-layout(?:-[a-z-]+)?\.php$/D', basename($file))) {
                $type = in_array(get_class($error), ['Error', 'TypeError', 'ValueError', 'RuntimeException', 'LogicException'], true)
                    ? get_class($error) : 'Throwable';
                self::$failureLocation = ' [' . basename($file) . ':' . $callback->getStartLine() . '; ' . $type . ']';
            }
        } finally {
            self::$depth--;
        }
    }

    public static function assertHealthy(): void
    {
        if (self::$failed || self::$depth !== 0) throw new \RuntimeException('Layout runtime hook callback failed' . self::$failureLocation);
    }

    public static function trace(int $options, int $limit): array
    {
        if ($limit < 1 || $limit > 64) throw new \RuntimeException('Invalid layout caller observation bound');
        $trace = debug_backtrace($options, $limit + self::$depth + 1);
        array_shift($trace);
        $trace = array_values(array_filter($trace, static fn(array $frame): bool =>
            ($frame['class'] ?? null) !== self::class));
        return array_slice($trace, 0, $limit);
    }
}
