<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
$hooks = dirname(getenv('MAGELENS_XML_HOOKS') ?: (require __DIR__ . '/project-root.php') . '/docker/php/xml-hooks.php');
require $hooks . '/xml-layout-runtime-hooks.php';
use MageLens\XmlCoverage\LayoutRuntimeHooks;
function checkRuntimeHook(bool $condition): void
{
    if (!$condition) throw new RuntimeException('Layout callback isolation assertion failed');
}
function nativeCallbackBoundary(Closure $callback, object $subject, object $error): object
{
    $callback($subject, $error);
    return $subject;
}
$case = $argv[1] ?? 'healthy';
if ($case === 'healthy') {
    $subject = new stdClass(); $error = new RuntimeException('private-native-error');
    $callback = LayoutRuntimeHooks::wrap(static function ($actual, $actualError) use ($subject, $error) {
        checkRuntimeHook($actual === $subject && $actualError === $error);
        $trace = LayoutRuntimeHooks::trace(DEBUG_BACKTRACE_IGNORE_ARGS, 2);
        checkRuntimeHook(count($trace) === 2 && $trace[1]['function'] === 'nativeCallbackBoundary');
        checkRuntimeHook(!isset($trace[0]['args']) && !isset($trace[1]['args']));
        return [0 => ['preserved' => $subject]];
    });
    checkRuntimeHook(nativeCallbackBoundary($callback, $subject, $error) === $subject);
    checkRuntimeHook(LayoutRuntimeHooks::wrap(null) === null);
    LayoutRuntimeHooks::assertHealthy();
    echo "Verified native caller identity, callback inputs and unchanged return values.\n";
    exit;
}
$calls = 0;
if ($case === 'throw') {
    $callback = LayoutRuntimeHooks::wrap(static function () use (&$calls) {
        $calls++;
        throw new Error('private-callback-error');
    });
    checkRuntimeHook($callback() === null && $callback() === null && $calls === 1);
} elseif ($case === 'depth') {
    $callback = null;
    $callback = LayoutRuntimeHooks::wrap(static function () use (&$calls, &$callback) {
        $calls++;
        return $callback();
    });
    checkRuntimeHook($callback() === null && $calls === 512);
} elseif ($case === 'trace-limit') {
    $callback = LayoutRuntimeHooks::wrap(static fn() => LayoutRuntimeHooks::trace(DEBUG_BACKTRACE_IGNORE_ARGS, 65));
    checkRuntimeHook($callback() === null);
} elseif ($case === 'location') {
    require $hooks . '/xml-layout-positions.php';
    $positions = new MageLens\XmlCoverage\LayoutPositionCoverage(static fn() => []);
    $original = (new ReflectionMethod($positions, 'revoke'))->getClosure($positions);
    $callback = LayoutRuntimeHooks::wrap($original);
    checkRuntimeHook($callback(null, ['private-callback-value'], []) === null);
} else throw new RuntimeException('Unknown layout callback test case');
try {
    LayoutRuntimeHooks::assertHealthy();
    throw new RuntimeException('Callback failure did not block publication');
} catch (RuntimeException $error) {
    checkRuntimeHook($case === 'location'
        ? preg_match('/^Layout runtime hook callback failed \[xml-layout-positions\.php:\d+; TypeError\]$/D', $error->getMessage()) === 1
        : $error->getMessage() === 'Layout runtime hook callback failed');
}
echo "Verified bounded callback failure blocks publication without private error data: $case.\n";
