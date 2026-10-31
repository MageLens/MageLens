<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
require dirname(__DIR__) . '/docker/php/sync-source.php';

function check(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}
function put(string $root, string $file, string $content): void
{
    if (!is_dir(dirname("$root/$file"))) mkdir(dirname("$root/$file"), 0755, true);
    file_put_contents("$root/$file", $content);
}
function inventory(string $root): void
{
    atomicSourceWrite("$root/.magelens-source.json", json_encode(sourceInventory($root), JSON_THROW_ON_ERROR));
}
function rejects(callable $operation, string $message): void
{
    try {
        $operation();
    } catch (RuntimeException $error) {
        check(str_contains($error->getMessage(), $message), $error->getMessage());
        return;
    }
    throw new RuntimeException("Expected refusal: $message");
}
function removeTree(string $directory): void
{
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $entry) {
        if ($entry->isDir() && !$entry->isLink()) rmdir($entry->getPathname());
        else unlink($entry->getPathname());
    }
    rmdir($directory);
}

$temporary = sys_get_temp_dir() . '/magelens-source-test-' . bin2hex(random_bytes(8));
mkdir($temporary);
try {
    $source = "$temporary/source";
    $target = "$temporary/target";
    foreach ([$source, $target] as $root) {
        put($root, 'composer.json', '{"version":"2.4.8-p5"}');
        put($root, 'app/code/Magento/Example.php', 'old core');
        put($root, 'lib/removed.php', 'old file');
        put($root, 'lib/unchanged.php', 'same upstream content');
        put($root, 'vendor/bin/tool.php', 'old executable');
        chmod("$root/vendor/bin/tool.php", 0755);
        symlink('tool.php', "$root/vendor/bin/tool");
        inventory($root);
    }
    foreach (['app/code/Application/Blog/registration.php', 'app/code/Other/Module.php',
        'app/etc/env.php', 'app/etc/config.php', 'pub/media/photo.jpg', 'var/local-data', 'generated/code/local.php'] as $file) {
        put($target, $file, 'keep local data');
    }
    put($target, 'lib/unchanged.php', 'local edit where upstream is unchanged');
    put($source, 'composer.json', '{"version":"2.4.9"}');
    put($source, 'app/code/Magento/Example.php', 'new core');
    put($source, 'lib/added.php', 'new file');
    unlink("$source/lib/removed.php");
    put($source, 'vendor/bin/new-tool.php', 'new executable');
    chmod("$source/vendor/bin/new-tool.php", 0755);
    unlink("$source/vendor/bin/tool");
    symlink('new-tool.php', "$source/vendor/bin/tool");
    inventory($source);
    syncSource($source, $target);
    check(sourceVersion($target) === '2.4.9', 'Magento release was not updated');
    check(file_get_contents("$target/app/code/Magento/Example.php") === 'new core', 'Core not updated');
    check(file_get_contents("$target/lib/added.php") === 'new file', 'New core file missing');
    check(!file_exists("$target/lib/removed.php"), 'Obsolete owned file retained');
    check(readlink("$target/vendor/bin/tool") === 'new-tool.php', 'Vendor symlink not updated');
    check(is_executable("$target/vendor/bin/new-tool.php"), 'Executable mode lost');
    check(file_get_contents("$target/app/etc/env.php") === 'keep local data', 'Configuration changed');
    check(file_get_contents("$target/pub/media/photo.jpg") === 'keep local data', 'Media changed');
    check(file_get_contents("$target/app/code/Other/Module.php") === 'keep local data', 'Custom module changed');
    check(file_get_contents("$target/lib/unchanged.php") === 'local edit where upstream is unchanged', 'Unrelated core edit lost');
    syncSource($source, $target);
    echo "PASS: release updates, obsolete files, symlinks, custom source, runtime data, and reruns\n";

    put($source, 'composer.json', '{"version":"2.4.9-p1"}');
    put($source, 'app/code/Magento/Example.php', 'next core');
    inventory($source);
    put($target, 'app/code/Magento/Example.php', 'local core edit');
    rejects(fn() => syncSource($source, $target), 'overwrite local changes');
    check(sourceVersion($target) === '2.4.9', 'Conflict caused a partial update');
    check(file_get_contents("$target/app/code/Magento/Example.php") === 'local core edit', 'Conflicting edit overwritten');
    echo "PASS: conflicts stop before any source update\n";

    // One replacement already completed, but the ownership file still describes
    // the previous release: this is the state after an interrupted update.
    put($target, 'app/code/Magento/Example.php', 'next core');
    syncSource($source, $target);
    check(sourceVersion($target) === '2.4.9-p1', 'Interrupted update did not resume');
    put($source, 'composer.json', '{"version":"2.4.8-p5"}');
    inventory($source);
    rejects(fn() => syncSource($source, $target), 'downgrades');
    echo "PASS: interrupted update recovery and downgrade refusal\n";

    unlink("$target/.magelens-source.json");
    rejects(fn() => syncSource($source, $target), 'no source inventory');
    put($source, 'composer.json', '{"version":"2.4.9-p1"}');
    inventory($source);
    put($target, 'app/code/Magento/Example.php', 'legacy local edit');
    syncSource($source, $target);
    check(file_get_contents("$target/app/code/Magento/Example.php") === 'legacy local edit', 'Legacy source adoption overwrote an edit');
    echo "PASS: legacy installations require matching release adoption and preserve local edits\n";

    put($source, 'composer.json', '{"version":"2.4.9-p2"}');
    put($source, 'lib/added.php', 'updated file');
    inventory($source);
    rename("$target/lib", "$target/local-lib");
    symlink('local-lib', "$target/lib");
    rejects(fn() => syncSource($source, $target), 'overwrite local changes');
    check(sourceVersion($target) === '2.4.9-p1', 'Symlink conflict caused partial upgrade');
    echo "PASS: directory symlinks cannot redirect a source update\n";

    $archive = "$temporary/archive";
    $composer = "$temporary/composer";
    put($archive, 'composer.json', '{"name":"magento/magento2ce","version":"2.4.8-p5"}');
    put($archive, 'composer.lock', 'archive lock');
    put($archive, 'app/code/Magento/Catalog/registration.php', 'archive module');
    put($archive, 'lib/internal/Magento/Framework/App/Bootstrap.php', 'archive framework');
    inventory($archive);
    foreach (['app/code/Vitalii/TodoList/registration.php', 'app/design/frontend/Client/theme/theme.xml',
        'app/etc/env.php', 'app/etc/config.php', 'pub/media/client.jpg', 'auth.json'] as $file) {
        put($archive, $file, 'preserved client data');
    }
    put($composer, 'composer.json', '{"name":"magento/project-community-edition","require":{"magento/product-community-edition":"2.4.8-p5"}}');
    put($composer, 'composer.lock', 'Composer project lock');
    put($composer, 'vendor/magento/module-catalog/registration.php', 'Composer module');
    put($composer, 'vendor/magento/framework/App/Bootstrap.php', 'Composer framework');
    put($composer, '.magelens-composer-ready', '');
    inventory($composer);
    check(sourceVersion($composer) === '2.4.8-p5', 'Composer product version was not detected');
    // A locally edited core file blocks migration before deleting anything.
    put($archive, 'app/code/Magento/Catalog/registration.php', 'locally edited core');
    rejects(fn() => syncSource($composer, $archive), 'overwrite local changes');
    check(file_get_contents("$archive/composer.lock") === 'archive lock', 'Conflict modified the lock');
    check(!is_dir("$archive/vendor"), 'Conflict partially installed vendor');
    put($archive, 'app/code/Magento/Catalog/registration.php', 'archive module');
    syncSource($composer, $archive);
    check(!is_dir("$archive/app/code/Magento"), 'Empty archive module directories remain');
    check(!is_dir("$archive/lib/internal/Magento"), 'Empty archive framework directories remain');
    check(is_file("$archive/vendor/magento/module-catalog/registration.php"), 'Composer module missing');
    check(is_file("$archive/vendor/magento/framework/App/Bootstrap.php"), 'Composer framework missing');
    check(file_get_contents("$archive/composer.lock") === 'Composer project lock', 'Composer lock missing');
    foreach (['app/code/Vitalii/TodoList/registration.php', 'app/design/frontend/Client/theme/theme.xml',
        'app/etc/env.php', 'app/etc/config.php', 'pub/media/client.jpg', 'auth.json'] as $file) {
        check(file_get_contents("$archive/$file") === 'preserved client data', "Migration changed $file");
    }
    syncSource($composer, $archive);
    echo "PASS: archive migration puts core in vendor, preserves client data, rejects conflicts, and reruns\n";

    $unknown = "$temporary/unknown";
    put($unknown, 'composer.json', '{"name":"magento/magento2ce","version":"2.4.8-p5"}');
    put($unknown, 'app/code/Magento/Catalog/registration.php', 'archive module');
    rejects(fn() => syncSource($composer, $unknown), 'no source inventory');
    check(is_file("$unknown/app/code/Magento/Catalog/registration.php"), 'Unowned archive file deleted');
    inventory($unknown);
    put($unknown, 'app/code/Magento/Catalog/local-file.php', 'unowned local file');
    syncSource($composer, $unknown);
    check(file_get_contents("$unknown/app/code/Magento/Catalog/local-file.php") === 'unowned local file', 'Unowned core file deleted');
    echo "PASS: archive migration requires ownership and preserves unowned files\n";

    $mageosSource = "$temporary/mageos-source";
    $mageosTarget = "$temporary/mageos-target";
    foreach ([$mageosSource, $mageosTarget] as $root) {
        put($root, 'composer.json', '{"name":"customer/shop","version":"1.0.0","require":{"mage-os/product-community-edition":"2.2.2"}}');
        put($root, 'vendor/mage-os/framework/example.php', 'old Mage-OS core');
        inventory($root);
        check(sourceVersion($root) === '2.2.2', 'Mage-OS product version was not detected');
        check(sourcePlatform($root) === 'mageos', 'Mage-OS platform was not detected');
    }
    put($mageosSource, 'composer.json', '{"require":{"mage-os/product-community-edition":"2.3.0"}}');
    put($mageosSource, 'vendor/mage-os/framework/example.php', 'new Mage-OS core');
    put($mageosTarget, 'pub/media/photo.jpg', 'client media');
    inventory($mageosSource);
    syncSource($mageosSource, $mageosTarget);
    check(sourceVersion($mageosTarget) === '2.3.0', 'Mage-OS release was not updated');
    check(file_get_contents("$mageosTarget/vendor/mage-os/framework/example.php") === 'new Mage-OS core', 'Mage-OS core not updated');
    check(file_get_contents("$mageosTarget/pub/media/photo.jpg") === 'client media', 'Mage-OS media changed');
    checkSourcePlatform($mageosTarget, 'mageos');
    rejects(fn() => checkSourcePlatform($mageosTarget, 'magento'), 'different platform');
    rejects(fn() => syncSource($composer, $mageosTarget), 'different platform');
    rejects(fn() => syncSource($mageosSource, $archive), 'different platform');
    check(sourceVersion($mageosTarget) === '2.3.0', 'Platform switch changed Mage-OS source');
    echo "PASS: Mage-OS product detection, upgrades, preserved media, and platform-switch refusal\n";

    $legacyInventory = json_decode(file_get_contents("$composer/.magelens-source.json"), true, flags: JSON_THROW_ON_ERROR);
    unset($legacyInventory['platform']);
    atomicSourceWrite("$composer/.magelens-source.json", json_encode($legacyInventory, JSON_THROW_ON_ERROR));
    check(readSourceInventory("$composer/.magelens-source.json")['platform'] === 'magento', 'Legacy inventory must remain Magento');
    syncSource($composer, $archive);
    echo "PASS: existing Magento inventories remain compatible\n";
} finally {
    removeTree($temporary);
}
