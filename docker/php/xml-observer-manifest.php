<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\Config\FileResolverInterface;
use Magento\Framework\Config\ConverterInterface;
use Magento\Framework\Config\ValidationStateInterface;
use Magento\Framework\Event\Config\Reader;
use Magento\Framework\Event\Invoker\InvokerDefault;
use Magento\Framework\Event\InvokerInterface;
use Magento\Framework\Event\ObserverInterface;
use Magento\Framework\ObjectManager\ConfigInterface;
use Magento\Framework\ObjectManager\ConfigLoaderInterface;

final class ObserverManifest
{
    public const AREAS = Xml::HTTP_AREAS;
    private const DEFAULTS = ['disabled' => false, 'shared' => true];

    /** Replay the installed reader over a single snapshot, retaining per-attribute origins. */
    public static function read(Reader $reader, array $known): array
    {
        $resolverProperty = new \ReflectionProperty(Reader::class, '_fileResolver');
        $converterProperty = new \ReflectionProperty(Reader::class, '_converter');
        $resolver = $resolverProperty->getValue($reader);
        $converter = $converterProperty->getValue($reader);
        $replay = clone $reader;
        $capture = new class implements FileResolverInterface {
            public array $files = [];
            public function get($filename, $scope = null) { return $this->files; }
        };
        $resolverProperty->setValue($replay, $capture);
        $validation = new \ReflectionProperty(Reader::class, 'validationState');
        $noValidation = new class implements ValidationStateInterface {
            public function isValidationRequired() { return false; }
        };
        $annotated = clone $replay;
        $validation->setValue($annotated, $noValidation);
        (new \ReflectionProperty(Reader::class, '_perFileSchema'))->setValue($annotated, null);
        $tracer = new class($converter) implements ConverterInterface {
            public array $owners = [];
            public function __construct(private ConverterInterface $converter) {}
            public function convert($source)
            {
                $converted = $this->converter->convert($source);
                $this->owners = ObserverManifest::owners($source, $converted);
                return $converted;
            }
        };
        $converterProperty->setValue($annotated, $tracer);

        $sources = []; $configs = []; $origins = []; $providers = [];
        $attributes = ['name', 'instance', 'method', ...array_keys(self::DEFAULTS)];
        foreach ([...self::AREAS, 'primary'] as $area) {
            $capture->files = iterator_to_array((function () use ($resolver, $area) {
                yield from $resolver->get('events.xml', $area);
            })());
            $configs[$area] = $replay->read($area);
            foreach ($capture->files as $file => &$bytes) {
                $providers[$file] = hash('sha256', $bytes);
                $sources[$area][$file] = $providers[$file];
                $dom = Xml::document($bytes);
                foreach ((new \DOMXPath($dom))->query('/config/event/observer') as $node) {
                    $path = $node->getNodePath();
                    $id = $known[$file][$path] ?? hash('sha256', "$file\0$path");
                    foreach ($attributes as $attribute) {
                        if ($node->hasAttribute($attribute)) $node->setAttribute("magelens-origin-$attribute", $id);
                    }
                }
                $bytes = $dom->saveXML();
            }
            unset($bytes);
            $tracer->owners = [];
            if ($annotated->read($area) !== $configs[$area]) {
                throw new \RuntimeException('Cannot reproduce Magento event reader provenance');
            }
            $origins[$area] = $tracer->owners;
        }
        return [$configs, $origins, $sources, $providers];
    }

    public static function owners(\DOMDocument $document, array $converted): array
    {
        $result = [];
        foreach ((new \DOMXPath($document))->query('/config/event') as $eventNode) {
            $event = mb_strtolower($eventNode->getAttribute('name'));
            // Converter replaces the whole entry when raw event names differ only in case.
            $result[$event] = [];
            foreach ($eventNode->childNodes as $node) {
                if (!$node instanceof \DOMElement || $node->tagName !== 'observer') continue;
                $name = $node->getAttribute('name');
                $config = $converted[$event][$name] ?? null;
                $result[$event][$name] = [];
                if ($config === null) continue;
                // Conversion omits default values even when XML supplied them explicitly.
                foreach (array_keys($config + self::DEFAULTS) as $key) {
                    $origin = $node->getAttribute("magelens-origin-$key");
                    if ($origin !== '') $result[$event][$name][$key] = $origin;
                }
            }
        }
        return $result;
    }

    public static function mergeOrigins(array $global, array $area, array $globalOrigins, array $areaOrigins): array
    {
        foreach ($area as $event => $observers) {
            foreach ($observers as $name => $config) {
                // Scoped configuration merges converted arrays. An omitted area
                // default has no effect on a key that survives from global.
                $retainedGlobal = array_diff_key($global[$event][$name] ?? [], $config);
                $globalOrigins[$event][$name] = array_replace(
                    array_diff_key($globalOrigins[$event][$name] ?? [], $config),
                    array_diff_key($areaOrigins[$event][$name] ?? [], $retainedGlobal)
                );
            }
        }
        return $globalOrigins;
    }

    public static function registration(array $config, array $origins, string $id, bool $active, callable $implementation): array
    {
        if (!$active) return ['unsupported', 'Declaration is inactive in the installed event reader', null];
        $nameOrigin = $origins['name'] ?? null;
        unset($origins['name']);
        $contributors = array_unique($origins ?: [$nameOrigin]);
        if (!in_array($id, $contributors, true)) return ['overridden', 'Superseded by another declaration', null];
        if (($config['disabled'] ?? self::DEFAULTS['disabled']) === true) return ['disabled', 'Effective Magento registration is disabled', null];
        if (count($contributors) !== 1) return ['ambiguous', 'Multiple declarations supply the effective observer attributes', null];
        $class = $implementation($config['instance'] ?? '');
        return $class ? ['eligible', null, $class] : ['unsupported', 'Observer implementation or invoker is unsupported', null];
    }

    public static function prepare($om, array &$files, array $areas): array
    {
        $known = [];
        foreach ($files as $path => $file) {
            if ($file['family'] !== 'events') continue;
            foreach ($file['declarations'] as $item) $known[BP . '/' . $path][$item['node']] = $item['id'];
        }
        if (!$known) return [[], []];
        [$configs, $origins, $sources, $providers] = self::read($om->get(Reader::class), $known);
        $runtime = [];
        foreach ($areas as $area) {
            // Config\Data\Scoped loads 'global' first, then the current scope.
            $effective = array_replace_recursive($configs['global'], $configs[$area]);
            $owners = self::mergeOrigins($configs['global'], $configs[$area], $origins['global'], $origins[$area]);
            $di = clone $om->get(ConfigInterface::class);
            if ($area !== 'global') $di->extend($om->get(ConfigLoaderInterface::class)->load($area));
            $invoker = self::nativeClass($di->getInstanceType($di->getPreference(InvokerInterface::class)));
            $implementation = static function (string $name) use ($di, $invoker): ?string {
                if ($name === '' || $invoker !== InvokerDefault::class) return null;
                $type = $di->getInstanceType($di->getPreference($name));
                if (!is_a($type, ObserverInterface::class, true)) return null;
                $method = new \ReflectionMethod(self::nativeClass($type), 'execute');
                return $method->isPublic() && !$method->isAbstract() ? $method->getDeclaringClass()->getName() : null;
            };
            foreach ($files as $path => &$file) {
                if ($file['family'] !== 'events') continue;
                foreach ($file['declarations'] as &$item) {
                    $scope = $item['declaredScope']['type'];
                    if ($scope !== 'global' && $scope !== $area) continue;
                    ['event' => $event, 'observer' => $observer] = $item['registration'];
                    $config = $effective[$event][$observer] ?? [];
                    $active = ($sources[$scope][BP . '/' . $path] ?? null) === $file['sourceHash'];
                    [$status, $reason, $class] = self::registration($config, $owners[$event][$observer] ?? [], $item['id'], $active, $implementation);
                    if ($area === 'global' && $status === 'eligible' && isset($configs['primary'][$event][$observer])) {
                        $status = 'unsupported';
                        $reason = 'An installation-level declaration also contributes before the HTTP area is set';
                    }
                    $item['areas'][$area] = ['status' => $status, 'reason' => $reason];
                    $item['supported'] = $item['supported'] || $status === 'eligible';
                    $runtime[$area][$event]['hash'] ??= self::signature($effective[$event] ?? []);
                    if ($status === 'eligible') {
                        $runtime[$area][$event]['targets'][$observer] = [
                            'id' => $item['id'], 'hash' => self::signature($config), 'class' => $class,
                        ];
                    }
                    if ($area === 'global') {
                        $primary = array_replace_recursive($configs['global'][$event] ?? [], $configs['primary'][$event] ?? []);
                        $runtime[$area][$event]['primaryHash'] = self::signature($primary);
                    }
                }
                unset($item);
            }
            unset($file);
        }
        foreach ($files as &$file) {
            if ($file['family'] !== 'events') continue;
            foreach ($file['declarations'] as &$item) {
                $item['effective'] = $item['supported'];
                if (!isset($item['areas'])) {
                    $scope = $item['declaredScope']['type'];
                    $reason = in_array($scope, self::AREAS, true) ? 'Configuration area is not registered in the installation'
                        : 'Configuration scope is outside HTTP observer coverage';
                    $item['areas'] = [$scope => ['status' => 'unsupported', 'reason' => $reason]];
                }
            }
            unset($item);
        }
        self::checkCache($om->get(\Magento\Framework\Event\Config\Data::class), $runtime, $configs);
        return [$runtime, $providers];
    }

    private static function checkCache(\Magento\Framework\Event\Config\Data $data, array $runtime, array $configs): void
    {
        $type = \Magento\Framework\Config\Data\Scoped::class;
        $cache = (new \ReflectionProperty($type, '_cache'))->getValue($data);
        $id = (new \ReflectionProperty($type, '_cacheId'))->getValue($data);
        $serializer = (new \ReflectionProperty($type, 'serializer'))->getValue($data);
        $all = [];
        foreach ($runtime as $events) $all += $events;
        foreach (self::AREAS as $area) {
            $cached = $cache->load($area . '::' . $id);
            if (!$cached) continue;
            $read = $serializer->unserialize($cached);
            foreach ($area === 'global' ? $all : ($runtime[$area] ?? []) as $event => $target) {
                if (self::signature($read[$event] ?? []) !== self::signature($configs[$area][$event] ?? [])) {
                    throw new \RuntimeException('Cached event registrations differ from current XML provenance; use --refresh-cache');
                }
            }
        }
    }

    public static function signature(array $config): string
    {
        return hash('sha256', Xml::canonical($config));
    }

    public static function nativeClass(string $type): string
    {
        if (str_ends_with($type, '\\Interceptor') && is_a($type, \Magento\Framework\Interception\InterceptorInterface::class, true)) {
            return get_parent_class($type);
        }
        return $type;
    }
}
