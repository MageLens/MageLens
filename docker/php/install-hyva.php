<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
$file = '/var/www/html/composer.json';
$repository = json_decode(file_get_contents(__DIR__ . '/hyva-packages.json'), true, 512, JSON_THROW_ON_ERROR);
$version = getenv('HYVA_VERSION');
$themePackage = 'hyva-themes/magento2-default-theme-csp';
$packages = $repository['package'];
foreach ($packages as $package) {
    if (in_array($package['name'], [$themePackage, 'hyva-themes/magento2-theme-module'], true) && $package['version'] !== $version) {
        throw new RuntimeException('Update docker/php/hyva-packages.json to match HYVA_VERSION before installing.');
    }
}
$composer = json_decode(file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
if (($argv[1] ?? '') === '--check') {
    $lock = json_decode(file_get_contents('/var/www/html/composer.lock'), true, 512, JSON_THROW_ON_ERROR);
    $installed = array_column($lock['packages'], 'version', 'name');
    foreach ($packages as $package) {
        if (($installed[$package['name']] ?? '') !== $package['version'] || ($composer['require'][$package['name']] ?? '') !== $package['version']) exit(1);
    }
    exit(0);
}
// Public upstream release archives are pinned by commit. No Hyva credentials are
// needed for this default-theme snapshot; Checkout is a separate product.
$composer['repositories']['magelens-hyva'] = $repository;
foreach ($packages as $package) $composer['require'][$package['name']] = $package['version'];
file_put_contents($file, json_encode($composer, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");
