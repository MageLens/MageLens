<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

use Magento\Framework\App\Bootstrap;
use Magento\Framework\App\State;

$action = $argv[1] ?? '';
if ($action === 'prepare') {
    echo "{}\n";
    exit;
}
if ($action === 'cleanup') {
    exit;
}
if ($action !== 'before') {
    throw new RuntimeException('Expected before, prepare or cleanup');
}

require '/var/www/html/app/bootstrap.php';
$state = Bootstrap::create(BP, $_SERVER)->getObjectManager()->get(State::class);
if ($state->getMode() === State::MODE_PRODUCTION) {
    exit;
}

// Publish native Admin assets before the browser starts. Lazy asset generation
// serializes the cold RequireJS requests through the single test FPM worker.
$process = proc_open(
    [PHP_BINARY, 'bin/magento', 'setup:static-content:deploy', '--force', '--area', 'adminhtml', 'en_US'],
    [0 => STDIN, 1 => STDOUT, 2 => STDERR],
    $pipes,
    BP
);
if (!is_resource($process) || proc_close($process) !== 0) {
    throw new RuntimeException('Cannot publish Admin assets for the disposable UI fixture');
}
