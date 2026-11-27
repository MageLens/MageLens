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
$mode = $argv[1] ?? 'early';
$receiver = new class { public int $value = 0; };
$property = new ReflectionProperty($receiver, 'value');
$closure = function (): void {};
if ($mode === 'late-closure') Closure::bind($closure, null, null);
if ($mode === 'late-property') $property->setValue($receiver, 0);
try {
    LayoutRuntimeHooks::primeInternals();
    if (str_starts_with($mode, 'late-')) throw new LogicException('Late internal hook installation was accepted');
} catch (RuntimeException $error) {
    if (!str_starts_with($mode, 'late-') || !str_contains($error->getMessage(), 'register before application bootstrap')) throw $error;
    echo "Rejected late native internal observer installation.\n";
    exit;
}
if ($mode === 'limit') {
    try {
        for ($index = 0; $index < 1025; $index++) LayoutRuntimeHooks::register(Closure::class, 'bind', null, null);
        throw new LogicException('Internal subscriber limit was not enforced');
    } catch (RuntimeException $error) {
        if (!str_contains($error->getMessage(), '1024 callbacks')) throw $error;
    }
    echo "Verified bounded native internal subscribers.\n";
    exit;
}
$counts = ['pre' => 0, 'post' => 0, 'errors' => 0];
foreach ([Closure::class => ['bind', 'bindTo', 'call'], ReflectionProperty::class => ['setValue', 'setRawValue', 'setRawValueWithoutLazyInitialization']] as $class => $methods) {
    foreach ($methods as $method) {
        LayoutRuntimeHooks::register($class, $method,
            static function () use (&$counts, $mode): void {
                $counts['pre']++;
                if ($mode === 'callback-error') throw new RuntimeException('private-fixture-error');
            }, static function ($object, array $params, $result, ?Throwable $error) use (&$counts): void {
                $counts['post']++;
                if ($error) $counts['errors']++;
            });
    }
}
Closure::bind($closure, null, null);
$closure->bindTo(null, null);
$closure->call($receiver);
$property->setValue($receiver, 1);
$property->setRawValue($receiver, 2);
$property->setRawValueWithoutLazyInitialization($receiver, 3);
try { $property->setValue($receiver, 'invalid'); throw new LogicException('Expected native type rejection'); } catch (TypeError) {}
if ($receiver->value !== 3) throw new RuntimeException('Internal observer changed native effects');
if ($mode === 'callback-error') {
    try { LayoutRuntimeHooks::assertHealthy(); throw new LogicException('Callback failure was hidden'); }
    catch (RuntimeException $error) {
        if ($error->getMessage() !== 'Layout runtime hook callback failed') throw $error;
    }
    echo "Native effects survive callback failure; private error text is withheld and publication fails.\n";
    exit;
}
LayoutRuntimeHooks::assertHealthy();
if ($counts !== ['pre' => 7, 'post' => 7, 'errors' => 1]) throw new RuntimeException('Native internal subscriber evidence changed');
echo "Verified late subscriber delivery after early native installation, failures and unchanged effects.\n";
