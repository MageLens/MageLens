<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

require_once __DIR__ . '/xml-di-usage-manifest.php';

use Magento\Framework\App\ObjectManager as AppObjectManager;
use Magento\Framework\App\ObjectManager\ConfigLoader;
use Magento\Framework\App\ObjectManager\Environment\Developer as DeveloperEnvironment;
use Magento\Framework\Interception\ObjectManager\Config\Developer as DeveloperConfig;
use Magento\Framework\ObjectManager\Config\Config;
use Magento\Framework\ObjectManager\Config\Reader\Dom;
use Magento\Framework\ObjectManager\ConfigLoaderInterface;
use Magento\Framework\ObjectManager\Factory\Dynamic\Developer as DeveloperFactory;
use Magento\Framework\ObjectManager\ObjectManager;

final class PreferenceManifest
{
    public const AREAS = ['global', 'frontend', 'adminhtml'];
    public const LOOKUP_LINES = ['get' => 71, 'create' => 59];

    public static function nativeHooks(): bool
    {
        // These pinned bodies establish the lookup call sites, configuration
        // transitions, and the map and factory semantics used by the adapter.
        $hashes = [
            AppObjectManager::class => '5d8669179661973aa696891b8ae1ffcdb06b99951fed313d110b392077b1f58f',
            ObjectManager::class => '36a7a50d911c00c06a4fe09af9866e5540b7afcadb115d80b3f51b0dbb16af60',
            Config::class => '67bd481c7217dc6e7b3a2fccf014b3caf9201fa7676836a8287436be36fc5f8c',
            DeveloperConfig::class => 'f933be84382b9fae48653bb865ada798bb114dd07996126c7ae7453dbc764cdc',
            DeveloperFactory::class => 'db112044bcd4166bd0331f459dff451df28d76e10144829b8a4e268fac49882b',
            ConfigLoader::class => '25a68a03e567d054f064b7f392f12fc5a51bb1f38151b23846672f83cdb102f7',
            DeveloperEnvironment::class => '4d11d51528b18c3f76d72991acb6bcbb3e3b9598781d68c5fc124e3d3b3d9b22',
            \Magento\Framework\App\StaticResource::class => '523a7b8f792ed60e3e8fcd58fc4cfd8e57ad929fc200d61450933c18018140fb',
            \Magento\Framework\App\Http::class => 'fe2c5f2437a7bcf4e0be4fb9b6b20c8c8d41a1fc8c104ddbd1e156ec7b29e598',
            \Magento\Framework\App\Area::class => 'fe283d05890a449b755152c6b2c4726368f104eb465f32bd1f405bab5dfde21a',
        ];
        foreach ($hashes as $class => $hash) {
            $file = (new \ReflectionClass($class))->getFileName();
            if (!$file || hash('sha256', str_replace("\r\n", "\n", file_get_contents($file))) !== $hash) return false;
        }
        return true;
    }

    public static function nativeManager(object $manager): bool
    {
        // The installed application facade inherits all three measured
        // methods from the core Object Manager.
        return in_array(get_class($manager), [AppObjectManager::class, ObjectManager::class], true);
    }

    public static function configHash(Config $config): string
    {
        $preferences = $config->getPreferences();
        $virtualTypes = $config->getVirtualTypes();
        ksort($preferences);
        ksort($virtualTypes);
        return hash('sha256', json_encode([$preferences, $virtualTypes], JSON_THROW_ON_ERROR));
    }

    public static function deltaHash(array $data): string
    {
        $virtualTypes = [];
        foreach ($data as $name => $entry) if ($name !== 'preferences' && isset($entry['type'])) $virtualTypes[$name] = $entry['type'];
        // Order within each map is significant for raw aliases such as \Foo
        // and Foo that Magento normalizes to the same key during extend().
        return hash('sha256', json_encode([$data['preferences'] ?? [], $virtualTypes], JSON_THROW_ON_ERROR));
    }

    /** @return array{list<string>, ?string, ?string} */
    public static function resolve(string $requested, array $preferences, array $virtualTypes): array
    {
        $edges = [];
        $terminal = $requested;
        while (isset($preferences[$terminal])) {
            if (isset($edges[$terminal])) return [array_keys($edges), null, null];
            $edges[$terminal] = true;
            $terminal = $preferences[$terminal];
        }
        [, $resolved] = DiUsageManifest::virtualPath($terminal, $virtualTypes);
        return [array_keys($edges), $terminal, $resolved];
    }

    public static function prepare($om, array &$files): array
    {
        $items = $usage = $known = $paths = [];
        foreach ($files as $path => &$file) {
            if ($file['family'] !== 'plugins') continue;
            foreach ($file['declarations'] as &$item) {
                $known[BP . '/' . $path][$item['node']] = $item['id'];
                if ($item['family'] === 'preferences') $items[$item['id']] = &$item;
                elseif (in_array($item['family'], ['virtual-types', 'arguments'], true)) $usage[$item['id']] = &$item;
                else continue;
                $paths[$item['id']] = [$path, $file['sourceHash']];
            }
            unset($item);
        }
        unset($file);
        if (!$items && !$usage) return [[], null];

        $snapshot = PluginManifest::sources($om->get(Dom::class), $known, (bool)$items, (bool)$usage);
        [$configs, , $sources, , $origins, $usageOrigins] = $snapshot;
        $active = [];
        foreach ($items + $usage as $id => $item) {
            [$path, $hash] = $paths[$id];
            $provider = $sources[$item['declaredScope']['type']][BP . '/' . $path] ?? null;
            if ($provider !== null && $provider !== $hash) throw new \RuntimeException('Runtime DI XML differs from its inventoried source');
            $active[$id] = $provider !== null;
        }

        $loader = $om->get(ConfigLoaderInterface::class);
        $unsupported = match (true) {
            $om->get(\Magento\Framework\App\State::class)->getMode() !== \Magento\Framework\App\State::MODE_DEVELOPER
                => 'Preference coverage requires developer mode',
            !self::nativeManager($om), get_class($loader) !== ConfigLoader::class
                => 'Custom or compiled Object Manager configuration loading is unmeasured',
            get_class((new \ReflectionProperty(ObjectManager::class, '_config'))->getValue($om)) !== DeveloperConfig::class,
            get_class((new \ReflectionProperty(ObjectManager::class, '_factory'))->getValue($om)) !== DeveloperFactory::class
                => 'Custom or compiled Object Manager resolution is unmeasured',
            !self::nativeHooks() => 'Installed DI methods differ from the verified hook paths',
            default => null,
        };
        $nativeArguments = $usage && DiUsageManifest::nativeArguments();
        if ($nativeArguments && $unsupported === null) {
            $nativeConfig = (new \ReflectionProperty(ObjectManager::class, '_config'))->getValue($om);
            $nativeArguments = get_class((new \ReflectionProperty(Config::class, '_relations'))->getValue($nativeConfig))
                === \Magento\Framework\ObjectManager\Relations\Runtime::class;
        }
        $runtime = [];
        foreach (self::AREAS as $area) {
            $scopes = $area === 'global' ? ['primary', 'global'] : ['primary', 'global', $area];
            $config = new DeveloperConfig();
            $owners = [];
            foreach ($scopes as $scope) {
                $config->extend($configs[$scope]);
                $owners = array_replace($owners, $origins[$scope] ?? []);
            }
            $preferences = $config->getPreferences();
            $virtualTypes = $config->getVirtualTypes();
            $bindings = [];
            foreach ($items as $id => &$item) {
                $scope = $item['declaredScope']['type'];
                ['requested' => $requested, 'replacement' => $replacement] = $item['binding'];
                $applicable = $scope === 'global' || $scope === $area;
                $origin = $applicable ? ($owners[$requested] ?? null) : null;
                [, , $resolved] = self::resolve($requested, $preferences, $virtualTypes);
                [$status, $reason] = match (true) {
                    !$applicable => ['inactive', 'Declared for another configuration area'],
                    !$active[$id] => ['inactive', 'Source is outside the installed DI reader inputs'],
                    $unsupported !== null => ['unsupported', $unsupported],
                    !isset($preferences[$requested]) => ['ambiguous', 'No effective mapping in the installed DI configuration'],
                    !$origin => ['ambiguous', 'The effective provider could not be identified'],
                    $origin['id'] !== $id => ['overridden', 'The effective binding comes from another declaration'],
                    $preferences[$requested] !== $replacement => ['ambiguous', 'The effective mapping differs from the inventoried binding'],
                    $resolved === null => ['unsupported', 'The preference or virtual target chain has no resolvable terminal type'],
                    default => ['eligible', null],
                };
                $item['areas'][$area] = ['status' => $status, 'reason' => $reason, 'origin' => $origin,
                    'effectiveReplacement' => $applicable ? ($preferences[$requested] ?? null) : null,
                    'resolved' => $applicable && isset($preferences[$requested]) ? $resolved : null];
                if ($status === 'eligible') {
                    $item['supported'] = true;
                    $bindings[$requested] = $id;
                }
            }
            unset($item);
            $diUsage = DiUsageManifest::prepareArea($usage, $active, $usageOrigins, $config, $scopes, $area, $unsupported, $nativeArguments);
            if ($unsupported !== null) continue;
            $loaded = $loader->load($area);
            if ($diUsage['names'] ?? []) {
                $diUsage['argumentDelta'] = DiUsageManifest::argumentDelta($configs[$area]);
                if ($diUsage['argumentDelta'] !== DiUsageManifest::argumentDelta($loaded)) self::stale('loaded constructor arguments changed');
            }
            if (self::deltaHash($loaded) !== self::deltaHash($configs[$area])) self::stale();
            $routes = [];
            foreach ($preferences as $requested => $replacement) {
                [$edges, $terminal, $resolved] = self::resolve($requested, $preferences, $virtualTypes);
                $ids = [];
                foreach ($edges as $edge) if (isset($bindings[$edge])) $ids[] = $bindings[$edge];
                if ($resolved !== null && $ids) $routes[$requested] = ['terminal' => $terminal, 'resolved' => $resolved, 'ids' => $ids];
            }
            $runtime[$area] = ['delta' => self::deltaHash($configs[$area]), 'config' => self::configHash($config),
                'routes' => $routes, 'diUsage' => $diUsage];
        }
        $all = $items + $usage;
        foreach ($all as &$item) {
            $scope = $item['declaredScope']['type'];
            if (!in_array($scope, self::AREAS, true)) {
                $item['areas'][$scope] = ['status' => 'unsupported', 'reason' => 'Configuration area is outside synchronous storefront and Admin collection',
                    'origin' => null, 'effectiveReplacement' => null, 'resolved' => null];
            }
            $item['effective'] = $item['supported'];
        }
        unset($item);
        if (!array_filter($active)) $runtime = [];
        return [$runtime, $snapshot];
    }

    public static function stale(?string $reason = null): never
    {
        $context = $reason ? " ($reason)" : '';
        throw new \RuntimeException('Magento preferences or virtual types differ from prepared XML provenance' . $context
            . '. If using cached configuration, rerun with --refresh-cache');
    }
}
