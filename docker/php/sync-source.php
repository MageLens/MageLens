<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);

// Track only files supplied by the Magento Composer project. Runtime state and user-added
// modules are never candidates for deletion during a release update.
function protectedSourcePath(string $path): bool
{
    if (preg_match('~^app/(?:code/|design/(?:frontend|adminhtml)/)(?!Magento(?:/|$))~', $path)) return true;
    foreach (['.git', '.magelens-source.json', '.application-source-ready', '.application-source-copying',
        '.magelens-imported', '.magelens-composer-ready', 'auth.json', 'app/etc/env.php', 'app/etc/config.php', 'var', 'generated', 'pub/media', 'pub/static'] as $protected) {
        if ($path === $protected || str_starts_with($path, "$protected/")) return true;
    }
    return false;
}

function sourceFingerprint(string $file): ?string
{
    if (is_link($file)) return 'link:' . readlink($file);
    if (is_file($file)) return 'file:' . hash_file('sha256', $file);
    return file_exists($file) ? 'directory' : null;
}

function sourcePlatform(string $root): string
{
    $project = json_decode(file_get_contents("$root/composer.json"), true, flags: JSON_THROW_ON_ERROR);
    return isset($project['require']['mage-os/product-community-edition']) || str_starts_with($project['name'] ?? '', 'mage-os/')
        ? 'mageos' : 'magento';
}

function checkSourcePlatform(string $root, string $expected): void
{
    if (!in_array($expected, ['magento', 'mageos'], true) || sourcePlatform($root) !== $expected) {
        throw new RuntimeException('The project in src/ uses a different platform. Use --mageos for Mage-OS or omit it for Magento. Changing platforms requires a separate installation.');
    }
}

function sourceVersion(string $root): string
{
    $project = json_decode(file_get_contents("$root/composer.json"), true, flags: JSON_THROW_ON_ERROR);
    foreach (['mage-os/product-community-edition', 'magento/product-community-edition', 'magento/product-enterprise-edition'] as $package) {
        if (isset($project['require'][$package]) && preg_match('/^\d+\.\d+\.\d+(?:-p\d+)?$/D', $project['require'][$package])) {
            return $project['require'][$package];
        }
    }
    if (is_string($project['version'] ?? null)) return $project['version'];
    throw new RuntimeException('Cannot determine the installed application version from composer.json');
}

function atomicSourceWrite(string $file, string $content): void
{
    $temporary = tempnam(dirname($file), '.magelens-');
    try {
        if (file_put_contents($temporary, $content) === false || !chmod($temporary, 0644) || !rename($temporary, $file)) {
            throw new RuntimeException("Cannot write $file");
        }
    } finally {
        if (is_file($temporary)) unlink($temporary);
    }
}

function sourceInventory(string $root): array
{
    $files = [];
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
    foreach ($iterator as $file) {
        $relative = substr($file->getPathname(), strlen($root) + 1);
        if (!protectedSourcePath($relative)) $files[$relative] = sourceFingerprint($file->getPathname());
    }
    ksort($files, SORT_STRING);
    return ['platform' => sourcePlatform($root), 'version' => sourceVersion($root), 'files' => $files];
}

function readSourceInventory(string $file): array
{
    $inventory = json_decode(file_get_contents($file), true, flags: JSON_THROW_ON_ERROR);
    $inventory['platform'] ??= 'magento';
    if (!in_array($inventory['platform'], ['magento', 'mageos'], true)) {
        throw new RuntimeException("Invalid source inventory platform: $file");
    }
    if (!is_string($inventory['version'] ?? null) || !is_array($inventory['files'] ?? null)) {
        throw new RuntimeException("Invalid Magento source inventory: $file");
    }
    foreach ($inventory['files'] as $path => $fingerprint) {
        if (!is_string($path) || str_starts_with($path, '/') || preg_match('~(^|/)\.{1,2}(/|$)~', $path) ||
            protectedSourcePath($path) || !is_string($fingerprint) || !preg_match('/^(file:|link:)/', $fingerprint)) {
            throw new RuntimeException("Unsafe Magento source inventory path: $path");
        }
    }
    return $inventory;
}

function syncSource(string $source, string $target): void
{
    $incoming = readSourceInventory("$source/.magelens-source.json");
    checkSourcePlatform($target, $incoming['platform']);
    $label = $incoming['platform'] === 'mageos' ? 'Mage-OS' : 'Magento';
    $versionKey = $incoming['platform'] === 'mageos' ? 'MAGEOS_VERSION' : 'MAGENTO_VERSION';
    $state = "$target/.magelens-source.json";
    if (!is_file($state)) {
        $installedProject = json_decode(file_get_contents("$target/composer.json"), true, flags: JSON_THROW_ON_ERROR);
        $incomingProject = json_decode(file_get_contents("$source/composer.json"), true, flags: JSON_THROW_ON_ERROR);
        if (($installedProject['name'] ?? '') === 'magento/magento2ce' && ($incomingProject['name'] ?? '') !== 'magento/magento2ce') {
            throw new RuntimeException('This source-archive installation has no source inventory. Record its original ownership before migrating to Composer; local files have not been changed.');
        }
        // Older installations have no ownership inventory. Adopt the same
        // release's baseline without overwriting any of their local edits.
        $installed = sourceVersion($target);
        if ($installed !== $incoming['version']) {
            throw new RuntimeException("This installation has no source inventory. Run ./install.sh with its platform flags and $versionKey: \"$installed\" to record it, then select the new release.");
        }
        atomicSourceWrite($state, json_encode($incoming, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n");
        echo "Recorded $label $installed source ownership; existing files preserved.\n";
        return;
    }
    $previous = readSourceInventory($state);
    if ($previous['platform'] !== $incoming['platform']) {
        throw new RuntimeException('Changing platforms requires a separate installation; existing files and data have not been changed.');
    }
    if (version_compare($incoming['version'], $previous['version'], '<')) {
        throw new RuntimeException("$label downgrades need a separate checkout and database; existing data is not downgraded.");
    }
    $changes = [];
    $conflicts = [];
    foreach (array_unique(array_merge(array_keys($previous['files']), array_keys($incoming['files']))) as $path) {
        $before = $previous['files'][$path] ?? null;
        $after = $incoming['files'][$path] ?? null;
        if ($before === $after) continue;
        // Refuse traversal through a locally substituted directory symlink.
        for ($parent = dirname($path); $parent !== '.'; $parent = dirname($parent)) {
            if (is_link("$target/$parent") || (file_exists("$target/$parent") && !is_dir("$target/$parent"))) {
                $conflicts[] = $path;
                continue 2;
            }
        }
        $current = sourceFingerprint("$target/$path");
        if ($current === $after) continue; // Also makes interrupted updates resumable.
        if ($current !== $before) {
            $conflicts[] = $path;
        } else {
            $changes[$path] = $after;
        }
    }
    if ($conflicts) {
        throw new RuntimeException("$label update would overwrite local changes. Resolve these files before rerunning ./install.sh:\n" . implode("\n", $conflicts));
    }
    $emptyDirectories = [];
    foreach ($changes as $path => $after) {
        $destination = "$target/$path";
        if ($after === null) {
            if (!unlink($destination)) throw new RuntimeException("Cannot remove old Magento file: $path");
            for ($directory = dirname($path); $directory !== '.'; $directory = dirname($directory)) $emptyDirectories[$directory] = true;
            continue;
        }
        if (!is_dir(dirname($destination)) && !mkdir(dirname($destination), 0755, true)) {
            throw new RuntimeException("Cannot create directory for $path");
        }
        $temporary = tempnam(dirname($destination), '.magelens-');
        try {
            if (is_link("$source/$path")) {
                unlink($temporary);
                if (!symlink(readlink("$source/$path"), $temporary)) throw new RuntimeException("Cannot copy $path");
            } elseif (!copy("$source/$path", $temporary) || !chmod($temporary, fileperms("$source/$path") & 0777)) {
                throw new RuntimeException("Cannot copy $path");
            }
            if (!rename($temporary, $destination)) throw new RuntimeException("Cannot replace $path");
        } finally {
            if (file_exists($temporary) || is_link($temporary)) unlink($temporary);
        }
    }
    // Retire the archive's empty core directories; never remove unowned files.
    $directories = array_keys($emptyDirectories);
    usort($directories, static fn(string $a, string $b): int => strlen($b) <=> strlen($a));
    foreach ($directories as $directory) {
        $absolute = "$target/$directory";
        if (is_dir($absolute) && !is_link($absolute) && count(scandir($absolute)) === 2) rmdir($absolute);
    }
    atomicSourceWrite($state, json_encode($incoming, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n");
    printf("%s %s source ready (%d managed files updated).\n", $label, $incoming['version'], count($changes));
}

if (realpath($_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    try {
        if (($argv[1] ?? '') === 'inventory' && count($argv) === 3) {
            atomicSourceWrite("$argv[2]/.magelens-source.json", json_encode(sourceInventory($argv[2]), JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n");
        } elseif (($argv[1] ?? '') === 'sync' && count($argv) === 4) {
            syncSource($argv[2], $argv[3]);
        } elseif (($argv[1] ?? '') === 'check-platform' && count($argv) === 4) {
            checkSourcePlatform($argv[2], $argv[3]);
        } else {
            throw new RuntimeException('Usage: sync-source.php inventory SOURCE | sync SOURCE TARGET | check-platform SOURCE PLATFORM');
        }
    } catch (Throwable $error) {
        fwrite(STDERR, $error->getMessage() . "\n");
        exit(1);
    }
}
