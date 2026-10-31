<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
require __DIR__ . '/project.php';
$action = $argv[1] ?? '';
if (!in_array($action, ['before', 'prepare', 'cleanup'], true)) throw new RuntimeException('Expected before, prepare or cleanup');
$fixtures = [];
foreach (project()['modules'] as $module) {
    $hook = '/var/www/html/' . $module['root'] . '/Test/MageLens/hooks.php';
    if (!is_file($hook)) continue;
    $process = proc_open([PHP_BINARY, $hook, $action], [0 => STDIN, 1 => ['pipe', 'w'], 2 => STDERR], $pipes);
    if (!is_resource($process)) throw new RuntimeException("Cannot run project hook: $hook");
    $output = stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    if (proc_close($process) !== 0) throw new RuntimeException("Project hook failed: $hook ($action)");
    if ($action === 'prepare') $fixtures[$module['name']] = json_decode($output, true, flags: JSON_THROW_ON_ERROR);
    else echo $output;
}
if ($action === 'prepare') echo json_encode((object) $fixtures, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR), "\n";
