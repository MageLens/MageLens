<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
require_once __DIR__ . '/xml-data.php';
require_once __DIR__ . '/xml-recorder.php';
use MageLens\XmlCoverage\Recorder;

function startXmlHooks(string $run): void
{
    if (!function_exists('OpenTelemetry\\Instrumentation\\hook')) throw new RuntimeException('XML collection requires the pinned OpenTelemetry hook extension; rerun installation');
    Recorder::start($run);
    // Register before bootstrap/autoload. No application arguments, exceptions or
    // return values are changed. No spans, SDK, exporters or network calls exist.
    $hooks = [
        ['Magento\\Config\\App\\Config\\Type\\System', 'get', null,
            static function ($subject, array $params, $result, ?Throwable $error, string $class) {
                // Framework and Backend accessors share this native getter.
                // Observe its source value before defaults, flags or plugins
                // decorate it, excluding callbacks for overriding methods.
                if (!$error && $class === 'Magento\\Config\\App\\Config\\Type\\System') Recorder::systemRead($result, $params[0] ?? '');
            }],
        ['Magento\\Config\\Model\\Config\\Structure\\AbstractElement', 'getData', null,
            static function ($subject, array $params, $result, ?Throwable $error, string $class) {
                // Hooks also observe overrides. Keep only the native source
                // method, before an interceptor's afterGetData decorators.
                if (!$error && $class === 'Magento\\Config\\Model\\Config\\Structure\\AbstractElement' && is_array($result)) Recorder::fieldData($result);
            }],
        ['Magento\\Config\\Block\\System\\Config\\Form\\Field', 'render', null,
            static function ($subject, array $params, $result, ?Throwable $error) {
                if (!$error && $result !== '' && isset($params[0])) Recorder::render($params[0]);
            }],
    ];
    foreach (['save', 'delete'] as $method) $hooks[] = ['Magento\\Framework\\App\\Config\\Storage\\Writer', $method,
        static function ($subject, array $params) { Recorder::mutation(); }, null];
    foreach ($hooks as [$class, $method, $pre, $post]) {
        if (!\OpenTelemetry\Instrumentation\hook($class, $method, $pre, $post)) throw new RuntimeException('Cannot register XML runtime hook');
    }
}
