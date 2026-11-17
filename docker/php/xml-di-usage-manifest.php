<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\ObjectManager\Config\Config;
use Magento\Framework\ObjectManager\Factory\AbstractFactory;
use Magento\Framework\ObjectManager\Relations\Runtime;

final class DiUsageManifest
{
    public const NODES = '/config/virtualType[@type] | /config/type/arguments/argument | /config/virtualType/arguments/argument';
    private const OWNER = 'magelens-origin-di';
    private const METADATA = ['shared', 'sortOrder', 'translatable'];
    private const VALUE = 'magelens-origin-di-value';
    private const TYPE = 'magelens-origin-di-type';
    private const COMPLEX = 'magelens-origin-di-complex';
    private const XSI = 'http://www.w3.org/2001/XMLSchema-instance';

    public static function nativeArguments(): bool
    {
        $hashes = [
            AbstractFactory::class => '3c4b1b31c86352246b196bb944a99d0c95a0c470144320455e225c11bb7c8676',
            Runtime::class => 'ee515ab301a971e261ad15e9f7260f4c6f2088f5c7436d752848218636dc0e11',
        ];
        foreach ($hashes as $class => $hash) {
            $file = (new \ReflectionClass($class))->getFileName();
            if (!$file || hash('sha256', str_replace("\r\n", "\n", file_get_contents($file))) !== $hash) return false;
        }
        return true;
    }

    public static function annotate(\DOMElement $node, string $id): void
    {
        $node->setAttribute(self::OWNER, $id);
        if ($node->tagName !== 'argument') return;
        foreach ([$node, ...$node->getElementsByTagName('*')] as $entry) {
            $entry->setAttribute(self::OWNER, $id);
            foreach (self::METADATA as $attribute) {
                if ($entry->hasAttribute($attribute)) $entry->setAttribute(self::OWNER . '-' . $attribute, $id);
            }
            if ($entry->hasAttributeNS(self::XSI, 'type')) $entry->setAttribute(self::TYPE, $id);
            if ($entry->childNodes->length === 1 && $entry->firstChild instanceof \DOMText) {
                $entry->setAttribute(self::VALUE, $id);
            } elseif (!$entry->getElementsByTagName('*')->length && $entry->hasChildNodes()) {
                // The native DOM merger can retain text or CDATA in composite
                // scalar nodes. Only attribute a scalar with a proven owner.
                $entry->setAttribute(self::COMPLEX, '1');
            }
        }
    }

    public static function origins(\DOMDocument $document, array $data, array $locations): array
    {
        $xpath = new \DOMXPath($document);
        $types = [];
        foreach ($xpath->query('/config/type | /config/virtualType') as $node) {
            // The native converter assigns one entry per raw type name in DOM order.
            $name = $node->getAttribute('name');
            $arguments = [];
            foreach ($xpath->query('arguments/argument', $node) as $argument) {
                $owners = [];
                $dynamic = false;
                foreach ([$argument, ...$argument->getElementsByTagName('*')] as $entry) {
                    $owners[$entry->getAttribute(self::OWNER)] = true;
                    foreach (self::METADATA as $attribute) {
                        if ($entry->hasAttribute($attribute)) $owners[$entry->getAttribute(self::OWNER . '-' . $attribute)] = true;
                    }
                    if ($entry->hasAttributeNS(self::XSI, 'type')) $owners[$entry->getAttribute(self::TYPE)] = true;
                    if ($entry->hasAttribute(self::VALUE)) $owners[$entry->getAttribute(self::VALUE)] = true;
                    if ($entry->hasAttribute(self::COMPLEX)) $owners[''] = true;
                    if ($entry->getAttributeNS(self::XSI, 'type') === 'init_parameter') $dynamic = true;
                }
                $owner = count($owners) === 1 ? ($locations[array_key_first($owners)] ?? null) : null;
                $arguments[$argument->getAttribute('name')] = ['origin' => $owner, 'dynamic' => $dynamic];
            }
            $types[$name] = ['virtual' => $locations[$node->getAttribute(self::OWNER)] ?? null, 'arguments' => $arguments];
        }
        $virtual = $arguments = [];
        foreach ($data as $name => $entry) {
            if ($name === 'preferences') continue;
            $type = ltrim($name, '\\');
            if (isset($entry['type'])) $virtual[$type] = $types[$name]['virtual'] ?? null;
            foreach ($entry['arguments'] ?? [] as $key => $value) {
                $arguments[$type][$key] = ($types[$name]['arguments'][$key] ?? ['origin' => null, 'dynamic' => false])
                    + ['array' => is_array($value)];
            }
        }
        return ['virtual-types' => $virtual, 'arguments' => $arguments];
    }

    public static function rawArguments(Config $config): array
    {
        return (new \ReflectionProperty(Config::class, '_arguments'))->getValue($config);
    }

    public static function argumentHash(Config $config): string
    {
        $data = self::rawArguments($config);
        ksort($data);
        return hash('sha256', serialize($data));
    }

    public static function argumentDelta(array $data): string
    {
        $arguments = [];
        foreach ($data as $name => $entry) if ($name !== 'preferences' && isset($entry['arguments'])) $arguments[$name] = $entry['arguments'];
        return hash('sha256', serialize($arguments));
    }

    /** @return array{list<string>, ?string} */
    public static function virtualPath(string $type, array $virtual): array
    {
        $path = [];
        while (isset($virtual[$type])) {
            if (isset($path[$type])) return [array_keys($path), null];
            $path[$type] = true;
            $type = $virtual[$type];
        }
        return [array_keys($path), $type !== '' ? $type : null];
    }

    private static function mergesVirtualArgument(string $type, string $name, array $virtual, array $arguments): bool
    {
        if (!($arguments[$type][$name]['array'] ?? false) || !isset($virtual[$type])) return false;
        [$chain, $terminal] = self::virtualPath($virtual[$type], $virtual);
        if ($terminal === null) return false;
        // An alias inherits the nearest configured argument from its virtual
        // hierarchy. Two arrays at this merge point may retain both sources.
        foreach ([...$chain, $terminal] as $ancestor) {
            if (isset($arguments[$ancestor][$name])) return $arguments[$ancestor][$name]['array'];
        }
        return false;
    }

    public static function prepareArea(array &$items, array $sources, array $maps, Config $config, array $scopes,
        string $area, ?string $unsupported, bool $nativeArguments): array
    {
        $virtualOrigins = $argumentOrigins = [];
        foreach ($scopes as $scope) {
            $virtualOrigins = array_replace($virtualOrigins, $maps[$scope]['virtual-types'] ?? []);
            foreach ($maps[$scope]['arguments'] ?? [] as $type => $arguments) {
                $argumentOrigins[$type] = array_replace($argumentOrigins[$type] ?? [], $arguments);
            }
        }
        $virtual = $config->getVirtualTypes();
        $enabled = $names = $virtualIds = [];
        foreach ($items as $id => &$item) {
            $isVirtual = $item['family'] === 'virtual-types';
            $scope = $item['declaredScope']['type'];
            $applicable = $scope === 'global' || $scope === $area;
            $binding = $item['binding'];
            $type = $isVirtual ? $binding['requested'] : $binding['declaringType'];
            $entry = $argumentOrigins[$type][$binding['argument'] ?? ''] ?? null;
            $origin = $applicable ? ($isVirtual ? ($virtualOrigins[$type] ?? null) : ($entry['origin'] ?? null)) : null;
            [, $resolved] = self::virtualPath($type, $virtual);
            [$status, $reason] = match (true) {
                !$applicable => ['inactive', 'Declared for another configuration area'],
                !$sources[$id] => ['inactive', 'Source is outside the installed DI reader inputs'],
                $unsupported !== null => ['unsupported', $unsupported],
                !$isVirtual && !$nativeArguments => ['unsupported', 'Installed argument resolution differs from the verified hook path'],
                $isVirtual && $binding['replacement'] === '' => ['unsupported', 'This virtual type declaration supplies no target'],
                !$origin => ['ambiguous', 'The configured value has no unique XML source'],
                $origin['id'] !== $id => ['overridden', 'The effective configuration comes from another declaration'],
                $isVirtual && ($virtual[$type] ?? null) !== $binding['replacement'] => ['ambiguous', 'The mapped target differs from the inventoried target'],
                $resolved === null => ['unsupported', 'The virtual target chain has no resolvable terminal type'],
                !$isVirtual && $entry['dynamic'] => ['unsupported', 'Initialization parameters use runtime values'],
                !$isVirtual && self::mergesVirtualArgument($type, $binding['argument'], $virtual, $argumentOrigins)
                    => ['ambiguous', 'The virtual type merges this array with an inherited argument'],
                default => ['eligible', null],
            };
            $item['areas'][$area] = ['status' => $status, 'reason' => $reason, 'origin' => $origin,
                'effectiveReplacement' => $applicable && $isVirtual ? ($virtual[$type] ?? null) : null,
                'resolved' => $applicable && $isVirtual && isset($virtual[$type]) ? $resolved : null];
            if ($status !== 'eligible') continue;
            $item['supported'] = true;
            $enabled[$item['family']][$id] = true;
            if ($isVirtual) $virtualIds[$type] = $id;
            else $names[$binding['argument']] = true;
        }
        unset($item);
        if (!$enabled) return [];
        $routes = [];
        if ($virtualIds) foreach ($virtual as $type => $target) {
            [$chain, $resolved] = self::virtualPath($type, $virtual);
            $ids = [];
            foreach ($chain as $alias) if (isset($virtualIds[$alias])) $ids[] = $virtualIds[$alias];
            if ($ids && $resolved !== null) $routes[$type] = ['ids' => $ids, 'resolved' => $resolved];
        }
        $arguments = [];
        if ($names) foreach ($argumentOrigins as $type => $entries) {
            foreach (array_intersect_key($entries, $names) as $name => $entry) {
                $id = $entry['origin']['id'] ?? null;
                $arguments[$type][$name] = ['array' => $entry['array'], 'id' => isset($enabled['arguments'][$id]) ? $id : null];
            }
        }
        return ['eligible' => $enabled, 'virtualRoutes' => $routes, 'names' => $names, 'arguments' => $arguments,
            'virtual' => $names ? $virtual : [], 'argumentsHash' => $names ? self::argumentHash($config) : null];
    }
}
