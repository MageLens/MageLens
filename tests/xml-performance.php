<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace Magento\Framework\App {
    class Config { public function getValue($path = null, $scope = 'default', $code = null) { return 'original'; } }
}
namespace {
    require __DIR__ . '/../docker/php/xml-hooks.php';
    use MageLens\XmlCoverage\Recorder;
    $mode = $argv[1] ?? 'unhooked';
    @mkdir('/coverage');
    if ($mode !== 'unhooked') {
        file_put_contents('/coverage/xml-collector.json', json_encode(['run' => 'benchmark', 'id' => 'benchmark', 'paths' => ['journal/title' => true],
            'originScopes' => ['default' => ['journal/title' => 'title']], 'valueHashes' => ['default' => ['journal/title' => hash('sha256', json_encode('original'))]], 'scopes' => [], 'fields' => []], JSON_THROW_ON_ERROR));
        startXmlHooks('benchmark');
    }
    $config = new \Magento\Framework\App\Config;
    $samples = []; $iterations = 100000;
    for ($round = 0; $round < 7; $round++) {
        $start = hrtime(true);
        for ($index = 0; $index < $iterations; $index++) $config->getValue($mode === 'tracked' ? 'journal/title' : 'unrelated');
        $samples[] = (hrtime(true) - $start) / $iterations;
    }
    sort($samples);
    echo json_encode(['php' => PHP_VERSION, 'opentelemetry' => phpversion('opentelemetry'), 'pcov' => phpversion('pcov'),
        'mode' => $mode, 'iterations' => $iterations, 'medianNanosecondsPerCall' => $samples[3], 'peakMemoryBytes' => memory_get_peak_usage(true)], JSON_THROW_ON_ERROR), "\n";
}
