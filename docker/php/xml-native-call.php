<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

final class NativeCall
{
    private static array $sites = [];

    public static function implementation(string $class): string
    {
        if (!str_ends_with($class, '\\Interceptor') || !class_exists($class)) return $class;
        $parent = get_parent_class($class);
        // Mage-OS also generates interceptors without Magento's marker interface.
        return $parent && $class === $parent . '\\Interceptor' ? $parent : $class;
    }

    public static function site(string $class, string $method, string $statement): ?array
    {
        $key = $class . '::' . $method . ':' . $statement;
        if (!array_key_exists($key, self::$sites)) {
            $function = new \ReflectionMethod($class, $method);
            $file = $function->getFileName();
            $lines = is_string($file) ? file($file, FILE_IGNORE_NEW_LINES) : false;
            $matched = [];
            if ($lines !== false) for ($line = $function->getStartLine(); $line <= $function->getEndLine(); $line++) {
                if (trim($lines[$line - 1]) === $statement) $matched[] = $line;
            }
            self::$sites[$key] = count($matched) === 1 ? [$file, $matched[0]] : null;
        }
        return self::$sites[$key];
    }

    public static function matches(
        object $subject, string $declaring, string $callback, object $owner, string $class, string $method, string $statement
    ): bool {
        $site = self::site($class, $method, $statement);
        if ($site === null) return false;
        $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS | DEBUG_BACKTRACE_PROVIDE_OBJECT, 40);
        $interceptor = get_class($subject);
        foreach ($trace as $index => $frame) {
            if (($frame['object'] ?? null) !== $subject || strcasecmp($frame['function'], $callback) !== 0) continue;
            if (($frame['class'] ?? null) !== $declaring) return false;

            $caller = $trace[++$index] ?? [];
            if (str_ends_with($interceptor, '\Interceptor') && ($caller['object'] ?? null) === $subject) {
                // The generated wrapper either calls parent directly or uses the
                // native plugin continuation. Take the nearest wrapper for this
                // receiver so a recursive plugin invocation cannot borrow its caller.
                if (($caller['class'] ?? null) === $interceptor && ($caller['function'] === '___callParent'
                    || str_starts_with($caller['function'], '{closure'))) {
                    do {
                        $caller = $trace[++$index] ?? [];
                    } while ($caller && !(($caller['object'] ?? null) === $subject
                        && ($caller['class'] ?? null) === $interceptor && strcasecmp($caller['function'], $callback) === 0));
                }
                if (($caller['object'] ?? null) !== $subject || ($caller['class'] ?? null) !== $interceptor
                    || strcasecmp($caller['function'], $callback) !== 0) return false;
                $frame = $caller;
                $caller = $trace[++$index] ?? [];
            }
            if (!isset($caller['class']) && ($caller['function'] ?? null) === 'call_user_func_array') {
                $frame = $caller;
                $caller = $trace[$index + 1] ?? [];
            }
            return ($caller['object'] ?? null) === $owner && ($caller['class'] ?? null) === $class
                && $caller['function'] === $method && ($frame['file'] ?? null) === $site[0] && ($frame['line'] ?? null) === $site[1];
        }
        return false;
    }
}
