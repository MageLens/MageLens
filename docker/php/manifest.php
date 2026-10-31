<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
require_once '/opt/pcov-tools/pcov_manifest_tools.php';
require_once __DIR__ . '/project.php';

function applicationFiles(string $directory): array
{
    $files = [];
    if (is_dir($directory)) {
        foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS)) as $file) {
            if ($file->isFile()) $files[] = $file->getRealPath();
        }
    }
    sort($files, SORT_STRING);
    return $files;
}

function applicationIdentity(): array
{
    $root = '/var/www/html';
    $sources = [];
    foreach (project()['roots'] as $source) $sources = array_merge($sources, applicationFiles("$root/$source"));
    sort($sources, SORT_STRING);
    $scope = array_values(array_filter($sources,
        static fn(string $file): bool => (bool) preg_match('/\.(php|phtml)$/', $file)
            && !preg_match('~/(?:Test|Setup|node_modules|tailwind)/~', $file)));
    $digest = static fn(array $files): string => hash('sha256', json_encode(pcov_manifest_source_inventory($files), JSON_THROW_ON_ERROR));
    return [
        'scope' => pcov_manifest_source_inventory($scope),
        'identity' => pcov_manifest_environment_identity([
            'application_revision' => hash_file('sha256', "$root/composer.json"),
            'dependency_lock' => hash_file('sha256', "$root/composer.lock"),
            'modules_config' => $digest(["$root/app/etc/config.php", "$root/app/etc/env.php"]),
            // Developer mode creates factories/interceptors on first use. They are
            // outside coverage scope; only compiled DI metadata is a deployment input.
            'generated_code' => $digest(applicationFiles("$root/generated/metadata")),
            'source_tree' => $digest($sources),
            'coverage_config' => $digest([__DIR__ . '/coverage.ini', __DIR__ . '/collect.php', __DIR__ . '/collection.php', __FILE__, '/application/project.json', '/usr/local/etc/php/conf.d/zzz-magelens-scope.ini']),
            'cypress_patches' => $digest(array_merge(applicationPatchFiles(), array_values(array_filter(["$root/vendor/magento/framework/Session/SessionManager.php", "$root/vendor/mage-os/framework/Session/SessionManager.php", "$root/lib/web/mage/adminhtml/form.js"], 'is_file')))),
        ]),
    ];
}

function applicationPatchFiles(): array
{
    return array_values(array_filter(applicationFiles('/cypress-patches'), static fn(string $file): bool => str_ends_with($file, '.patch')));
}

if (realpath($_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    $state = applicationIdentity();
    $base = '/pcov-state/' . $state['identity']['id'];
    $manifest = $base . '.pcov';
    // Retain invalid generations for old records and publish a new path next time.
    $pointer = $base . '.current';
    if (is_file($pointer)) $manifest = trim(file_get_contents($pointer));
    if (is_file($manifest . '.invalid')) $manifest = $base . '-' . bin2hex(random_bytes(8)) . '.pcov';
    $state['manifestTarget'] = $manifest;
    $state['manifestPointer'] = $pointer;
    $state['manifest'] = is_file($manifest) ? $manifest : null;
    if ($state['manifest']) {
        $record = pcov_record_load($manifest);
        if ($record['record_type'] !== PCOV_RECORD_MANIFEST || $record['environment_id'] !== $state['identity']['id'] ||
            $record['fingerprints'] !== $state['scope']) {
            throw new RuntimeException('Persistent PCOV manifest does not match the authoritative source inventory. Remove .runtime/pcov/*.pcov and rerun.');
        }
    }
    file_put_contents('/coverage/collector.json', json_encode($state, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
    echo $state['manifest'] ? "Reusing immutable PCOV manifest $manifest\n" : "Full discovery: this run will publish $manifest\n";
}
