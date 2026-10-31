<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);

use SebastianBergmann\CodeCoverage\CodeCoverage;
use SebastianBergmann\CodeCoverage\Data\RawCodeCoverageData;
use SebastianBergmann\CodeCoverage\Driver\Selector;
use SebastianBergmann\CodeCoverage\Filter;

/** Lines containing PHP tokens, excluding emitted markup, comments and tag delimiters. */
function applicationPhpTokenLines(string $source): array
{
    $lines = [];
    $line = 1;
    $source = str_replace(["\r\n", "\r"], "\n", $source);
    foreach (token_get_all($source) as $token) {
        $text = is_array($token) ? $token[1] : $token;
        $id = is_array($token) ? $token[0] : null;
        if (!in_array($id, [T_INLINE_HTML, T_WHITESPACE, T_COMMENT, T_DOC_COMMENT, T_OPEN_TAG, T_CLOSE_TAG], true)) {
            foreach (explode("\n", $text) as $offset => $part) {
                if (trim($part) !== '') $lines[$line + $offset] = true;
            }
        }
        $line += substr_count($text, "\n");
    }
    return $lines;
}

/** Build reports against verified original files, retaining zero-hit files in the scope. */
function applicationPhpReportData(array $scope, array $merged, array $sourceHashes, string $testId,
    string $sourceRoot = '/source', string $runtimeRoot = '/var/www/html'): CodeCoverage
{
    $filter = new Filter;
    $raw = [];
    $allowed = [];
    foreach (array_keys($scope) as $runtimeFile) {
        if (!str_starts_with($runtimeFile, $runtimeRoot . '/')) {
            throw new RuntimeException("PHP file outside runtime root: $runtimeFile");
        }
        $relative = substr($runtimeFile, strlen($runtimeRoot) + 1);
        $original = $sourceRoot . '/' . $relative;
        if (!is_file($original) || realpath($original) !== $original ||
            !isset($sourceHashes['src/' . $relative]) ||
            !hash_equals($sourceHashes['src/' . $relative], hash_file('sha256', $original))) {
            throw new RuntimeException("Original PHP source is missing or changed: $relative. Update the installation and rerun coverage.");
        }
        $filter->includeFile($original);
        $allowed[$original] = applicationPhpTokenLines(file_get_contents($original));
        if (array_key_exists($runtimeFile, $merged)) $raw[$original] = $merged[$runtimeFile];
    }
    $coverage = new CodeCoverage((new Selector)->forLineCoverage($filter), $filter);
    $coverage->includeUncoveredFiles();
    // PCOV uses the same -1/1 line format as this standard raw-data API.
    $coverage->append(RawCodeCoverageData::fromXdebugWithoutPathCoverage($raw), $testId);
    // php-code-coverage expands executable ranges, including T_INLINE_HTML.
    // Filter after expansion and discovery, so neither can reintroduce markup.
    $data = $coverage->getData();
    $lines = $data->lineCoverage();
    foreach ($lines as $file => $hits) $lines[$file] = array_intersect_key($hits, $allowed[$file]);
    $data->setLineCoverage($lines);
    $coverage->setData($data);
    $coverage->excludeUncoveredFiles();
    return $coverage;
}
