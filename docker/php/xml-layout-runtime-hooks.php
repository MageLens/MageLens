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

    private function __construct(private readonly \Closure $callback) {}

    public static function wrap(?\Closure $callback): ?\Closure
    {
        return $callback === null ? null : (new self($callback))->__invoke(...);
    }

    public static function register(string $class, string $method, ?\Closure $pre, ?\Closure $post): bool
    {
        return \OpenTelemetry\Instrumentation\hook($class, $method, self::wrap($pre), self::wrap($post));
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
            ($frame['class'] ?? null) !== self::class || ($frame['function'] ?? null) !== '__invoke'));
        return array_slice($trace, 0, $limit);
    }
}
