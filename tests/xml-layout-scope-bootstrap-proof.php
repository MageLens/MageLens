<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
$hooks = dirname(getenv('MAGELENS_XML_HOOKS') ?: (require __DIR__ . '/project-root.php') . '/docker/php/xml-hooks.php');
require $hooks . '/xml-layout-runtime-hooks.php';
require $hooks . '/xml-layout-field-access.php';
use MageLens\XmlCoverage\{LayoutRuntimeHooks, LayoutFieldAccess};
LayoutRuntimeHooks::primeInternals();
$guard = new LayoutFieldAccess();
foreach ($guard->hooks() as [$class, $method, $pre, $post]) LayoutRuntimeHooks::register($class, $method, $pre, $post);
$autoloads = 0;
spl_autoload_register(static function () use (&$autoloads): void { $autoloads++; });
$receiver = new class {};
$function = function (): void {};
Closure::bind($function, null, get_class($receiver));
$function->bindTo(null, get_class($receiver));
$function->call($receiver);
if ($autoloads !== 0) throw new RuntimeException('Scoped metadata inspection autoloaded application classes before bootstrap');
$guard->finish();
LayoutRuntimeHooks::assertHealthy();
echo "Scoped metadata checks preserve native binding and perform zero application autoloads before bootstrap.\n";
