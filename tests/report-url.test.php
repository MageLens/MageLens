<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
require __DIR__ . '/../docker/php/report-url.php';

foreach (['https://magelens.test/', 'http://custom.test:8080/shop/', 'https://custom.test:8443/a/b', 'http://[::1]:8080/shop/'] as $base) {
    $expected = rtrim($base, '/') . '/media/coverage/index.html';
    if (coverageReportUrl($base) !== $expected) throw new RuntimeException("Incorrect report URL for $base");
}
foreach (['', '/shop/', 'ftp://custom.test/', 'https://custom.test/?query=1', 'https://custom.test/#fragment', 'http://user:password@custom.test/', "http://custom.test/\n"] as $base) {
    try {
        coverageReportUrl($base);
    } catch (RuntimeException $error) {
        continue;
    }
    throw new RuntimeException('Invalid base URL accepted.');
}
echo "Report URL checks passed.\n";
