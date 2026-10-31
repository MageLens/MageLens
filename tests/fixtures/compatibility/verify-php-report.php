<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
require '/application/docker/php/report-data.php';
$read = static fn(string $file): array => json_decode(file_get_contents('/coverage/' . $file), true, flags: JSON_THROW_ON_ERROR);
$summary = $read('php/coverage-summary.json');
$files = $read('php/line-coverage.json');
if ($summary['lineScope'] !== 'php-only' || $summary['sourceRoot'] !== '/source') throw new RuntimeException('PHP report must use original PHP source');
$total = $covered = 0;
foreach ($files as $file => $lines) {
    $source = file_get_contents('/source/' . $file);
    $allowed = applicationPhpTokenLines($source);
    foreach ($lines as $line => $hit) {
        if (!isset($allowed[$line]) || !in_array($hit, [0, 1], true)) throw new RuntimeException("Invalid PHP-only line: $file:$line");
        $total++;
        $covered += $hit;
    }
}
if ($summary['total'] !== $total || $summary['covered'] !== $covered) throw new RuntimeException('PHP totals differ from file counters');
$html = new RecursiveIteratorIterator(new RecursiveDirectoryIterator('/coverage/php', FilesystemIterator::SKIP_DOTS));
foreach ($html as $file) {
    if (!str_ends_with($file->getFilename(), '.phtml.html')) continue;
    if (str_contains(file_get_contents($file->getPathname()), '__mtcTemplateHit')) throw new RuntimeException('PHP report contains injected template instrumentation');
}
printf("PASS: %d/%d PHP-only lines across %d original source files; no injected template instrumentation.\n", $covered, $total, count($files));
