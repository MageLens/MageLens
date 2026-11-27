<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\App\ObjectManager\ConfigLoader\Compiled;
use Magento\Framework\Component\ComponentRegistrar;
use Magento\Framework\ObjectManager\Config\Reader\Dom;

final class CompiledProvenance
{
    private const SCHEMA = 2;
    private const STAMP = 'generated/metadata/magelens-di.json';
    private const SESSION_PATCH = 'magento-framework-session-cookie-race-41057.patch';
    private const SESSION_PATCH_HASH = '9177153105678ba52ae3c75f839433b60878795f5773ec8e80f58ef52018fc58';

    public static function inputs(array $providers): string
    {
        $application = [];
        foreach (['app/etc/config.php', 'composer.lock'] as $path) {
            $application[$path] = hash_file('sha256', BP . '/' . $path);
        }
        // The compiler reflects module, library and setup classes, whose
        // parents and constructor dependencies can also come from Composer.
        $roots = array_map(static fn($path) => BP . '/' . $path, ['app', 'lib', 'setup', 'vendor']);
        $registrar = new ComponentRegistrar();
        foreach ([ComponentRegistrar::MODULE, ComponentRegistrar::LIBRARY, ComponentRegistrar::SETUP] as $type) {
            foreach ($registrar->getPaths($type) as $path) {
                foreach ($roots as $root) {
                    if ($path === $root || str_starts_with($path, $root . '/')) continue 2;
                }
                $roots[] = $path;
            }
        }
        $php = [];
        foreach ($roots as $root) if (is_dir($root)) self::sourceHashes($root, $php);
        ksort($php, SORT_STRING);
        // Resolver order is significant to the XML merge.
        return hash('sha256', serialize([$providers, $application, $php]));
    }

    private static function sourceHashes(string $directory, array &$hashes, array $parents = []): void
    {
        $real = realpath($directory);
        if ($real === false || isset($parents[$real])) {
            throw new \RuntimeException('Cannot fingerprint compiled DI PHP inputs: missing directory or cyclic symlink');
        }
        $parents[$real] = true;
        foreach (new \FilesystemIterator($directory) as $entry) {
            $path = $entry->getPathname();
            if ($entry->isDir()) {
                self::sourceHashes($path, $hashes, $parents);
            } elseif ($entry->getExtension() === 'php' && $path !== BP . '/app/etc/env.php' && $entry->isFile()) {
                // Magento rewrites env.php when it switches deployment mode.
                $hashes[$path] = self::sourceHash($path);
            }
        }
    }

    private static function sourceHash(string $path): string
    {
        $hash = hash_file('sha256', $path);
        if ($hash === false) throw new \RuntimeException('Cannot fingerprint compiled DI PHP input ' . $path);
        if ($path !== BP . '/vendor/magento/framework/Session/SessionManager.php'
            && $path !== BP . '/vendor/mage-os/framework/Session/SessionManager.php') return $hash;

        $patchPath = '/cypress-patches/' . self::SESSION_PATCH;
        if (!is_file($patchPath)) $patchPath = dirname(__DIR__, 2) . '/patches/cypress/' . self::SESSION_PATCH;
        if (!is_file($patchPath)) return $hash;
        $patch = str_replace("\r\n", "\n", file_get_contents($patchPath));
        if (hash('sha256', $patch) !== self::SESSION_PATCH_HASH) return $hash;

        // The fixture patch only changes two method bodies. Reverse those exact
        // hunks on a copy so fixture setup and cleanup keep the same DI stamp.
        // Any other source change remains part of the fingerprint.
        $copy = tempnam(sys_get_temp_dir(), 'magelens-di-session-');
        if ($copy === false) throw new \RuntimeException('Cannot stage the compiled DI session source');
        try {
            if (!copy($path, $copy)) throw new \RuntimeException('Cannot copy the compiled DI session source');
            $patch = str_replace('/vendor/magento/framework/Session/SessionManager.php', '/' . basename($copy), $patch);
            $process = proc_open(['git', 'apply', '--no-index', '--unidiff-zero', '--reverse', '-'],
                [0 => ['pipe', 'r'], 1 => STDOUT, 2 => ['pipe', 'w']], $pipes, dirname($copy));
            if (!is_resource($process)) throw new \RuntimeException('Cannot check the session fixture patch');
            $written = fwrite($pipes[0], $patch);
            fclose($pipes[0]);
            $error = stream_get_contents($pipes[2]);
            fclose($pipes[2]);
            $status = proc_close($process);
            if ($written !== strlen($patch) || !in_array($status, [0, 1], true)) {
                throw new \RuntimeException('Cannot check the session fixture patch: ' . trim($error));
            }
            if ($status === 1) return $hash; // The reverse patch did not apply.
            $normalized = hash_file('sha256', $copy);
            if ($normalized === false) throw new \RuntimeException('Cannot fingerprint the normalized session source');
            return $normalized;
        } finally {
            unlink($copy);
        }
    }

    public static function metadata(array $areas): array
    {
        $files = [];
        foreach ($areas as $area) {
            $path = Compiled::getFilePath($area);
            if (!is_file($path)) throw new \RuntimeException("Compiled DI metadata is missing for $area");
            $files[$area] = hash_file('sha256', $path);
        }
        $additional = glob(BP . '/generated/metadata/*|plugin-list.php') ?: [];
        $additional[] = BP . '/generated/metadata/interception.php';
        sort($additional, SORT_STRING);
        foreach ($additional as $path) if (is_file($path)) $files[basename($path)] = hash_file('sha256', $path);
        return $files;
    }

    public static function validate(array $providers, array $areas): ?array
    {
        $path = BP . '/' . self::STAMP;
        if (!is_file($path)) return null;
        $stamp = json_decode(file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
        if ($stamp !== ['schema' => self::SCHEMA, 'inputs' => self::inputs($providers), 'metadata' => self::metadata($areas)]) {
            throw new \RuntimeException('Compiled DI provenance is stale. Rerun ./bin/deploy-production for fresh production coverage.');
        }
        return $stamp['metadata'];
    }

    public static function snapshot($manager): string
    {
        $snapshot = PluginManifest::sources($manager->get(Dom::class), []);
        return self::inputs($snapshot[2]);
    }

    public static function publish(string $before, string $after, array $areas): void
    {
        if ($before !== $after) throw new \RuntimeException('DI inputs changed during production deployment');
        $target = BP . '/' . self::STAMP;
        $temporary = tempnam(dirname($target), '.magelens-di-');
        if ($temporary === false) throw new \RuntimeException('Cannot stage compiled DI provenance');
        try {
            $stamp = json_encode(['schema' => self::SCHEMA, 'inputs' => $after, 'metadata' => self::metadata($areas)], JSON_THROW_ON_ERROR);
            if (file_put_contents($temporary, $stamp) !== strlen($stamp) || !rename($temporary, $target)) {
                throw new \RuntimeException('Cannot publish compiled DI provenance');
            }
        } finally {
            if (is_file($temporary)) unlink($temporary);
        }
    }
}

if (realpath($_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    require '/var/www/html/app/bootstrap.php';
    require_once __DIR__ . '/xml-data.php';
    require_once __DIR__ . '/xml-plugin-manifest.php';
    require_once __DIR__ . '/xml-preference-manifest.php';
    $manager = \Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
    $inputs = CompiledProvenance::snapshot($manager);
    if ($argc === 1) echo $inputs, PHP_EOL;
    else {
        $areas = Xml::enabledAreas($manager->get(\Magento\Framework\App\AreaList::class)->getCodes());
        CompiledProvenance::publish($argv[1], $inputs, $areas);
    }
}
