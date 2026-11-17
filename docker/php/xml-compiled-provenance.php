<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\App\ObjectManager\ConfigLoader\Compiled;
use Magento\Framework\ObjectManager\Config\Reader\Dom;

final class CompiledProvenance
{
    private const STAMP = 'generated/metadata/magelens-di.json';

    public static function inputs(array $providers): string
    {
        $application = [];
        foreach (['app/etc/config.php', 'composer.lock'] as $path) {
            $application[$path] = hash_file('sha256', BP . '/' . $path);
        }
        // Resolver order is significant to the merge.
        return hash('sha256', serialize([$providers, $application]));
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
        if ($stamp !== ['schema' => 1, 'inputs' => self::inputs($providers), 'metadata' => self::metadata($areas)]) {
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
            $stamp = json_encode(['schema' => 1, 'inputs' => $after, 'metadata' => self::metadata($areas)], JSON_THROW_ON_ERROR);
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
        $areas = Xml::enabledHttpAreas($manager->get(\Magento\Framework\App\AreaList::class)->getCodes());
        CompiledProvenance::publish($argv[1], $inputs, $areas);
    }
}
