<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Test;

final class SharedActionCounter
{
    public static int $calls = 0;
    public static function register(): void
    {
        if (!\OpenTelemetry\Instrumentation\hook(\Magento\Framework\DataObject::class, 'setData',
            static function ($subject, array $params, string $class): void {
                if ($class === \Magento\Framework\DataObject::class && $subject instanceof \MageLens\Compatibility\Block\LayoutShared
                    && ($params[0] ?? null) === 'shared_action_proof') self::$calls++;
            }, null)) throw new \RuntimeException('Cannot observe native shared action calls');
    }
}
