<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

require_once __DIR__ . '/xml-inline-plugins.php';

use Magento\Framework\Config\{ConverterInterface, FileResolverInterface, ValidationStateInterface};
use Magento\Framework\Interception\{DefinitionInterface, PluginListGenerator, PluginListInterface};
use Magento\Framework\Interception\ObjectManager\ConfigInterface;
use Magento\Framework\Interception\PluginList\PluginList;
use Magento\Framework\ObjectManager\Config\Reader\Dom;
use Magento\Framework\ObjectManager\ConfigLoaderInterface;
use Magento\Framework\ObjectManager\InterceptableValidator;

final class PluginManifest
{
    public const AREAS = ['global', 'frontend', 'adminhtml'];
    public const PHASES = [DefinitionInterface::LISTENER_BEFORE => 'before', DefinitionInterface::LISTENER_AROUND => 'around',
        DefinitionInterface::LISTENER_AFTER => 'after'];
    private const ORIGIN = 'magelens-origin-';

    /** Run the installed reader on original and annotated snapshots in resolver order. */
    public static function sources(Dom $reader, array $known): array
    {
        $resolver = new \ReflectionProperty(Dom::class, '_fileResolver');
        $converter = new \ReflectionProperty(Dom::class, '_converter');
        $original = $resolver->getValue($reader);
        $reader = clone $reader;
        $input = new class implements FileResolverInterface {
            public array $files = [];
            public function get($filename, $scope = null) { return $this->files; }
        };
        $resolver->setValue($reader, $input);
        $annotated = clone $reader;
        // Mage-OS memoizes converted scopes on each reader. Neither replay
        // may inherit a bootstrap-time result for its different resolver.
        foreach ([$reader, $annotated] as $replay) {
            if (method_exists($replay, '_resetState')) $replay->_resetState();
        }
        (new \ReflectionProperty(Dom::class, 'validationState'))->setValue($annotated, new class implements ValidationStateInterface {
            public function isValidationRequired() { return false; }
        });
        (new \ReflectionProperty(Dom::class, '_perFileSchema'))->setValue($annotated, null);
        $capture = new class($converter->getValue($reader)) implements ConverterInterface {
            public ?\DOMDocument $document = null;
            public function __construct(private ConverterInterface $native) {}
            public function convert($document)
            {
                $this->document = $document;
                return $this->native->convert($document);
            }
        };
        $converter->setValue($annotated, $capture);
        $config = $tagged = $sources = $providers = [];
        foreach (['primary', ...self::AREAS] as $scope) {
            $input->files = [];
            foreach ($original->get('di.xml', $scope) as $file => $bytes) {
                $input->files[$file] = $bytes;
                $sources[$scope][$file] = $providers[$file] = hash('sha256', $bytes);
            }
            $config[$scope] = $reader->read($scope);
            foreach ($input->files as $file => &$bytes) {
                $document = Xml::document($bytes);
                foreach (self::nodes($document) as $node) {
                    $path = $node->getNodePath();
                    $id = $known[$file][$path] ?? hash('sha256', "$file\0$path");
                    $node->setAttribute(self::ORIGIN . 'name', $id);
                    foreach (['type', 'sortOrder', 'disabled'] as $attribute) {
                        if ($node->hasAttribute($attribute)) $node->setAttribute(self::ORIGIN . $attribute, $id);
                    }
                }
                $bytes = $document->saveXML();
            }
            unset($bytes);
            $capture->document = null;
            if ($annotated->read($scope) !== $config[$scope] || ($input->files && !$capture->document)) {
                throw new \RuntimeException('Cannot reproduce Magento DI reader provenance');
            }
            $tagged[$scope] = self::tag($config[$scope], $capture->document);
        }
        return [$config, $tagged, $sources, $providers];
    }

    private static function nodes(\DOMDocument $document): \DOMNodeList
    {
        return (new \DOMXPath($document))->query('/config/type/plugin | /config/virtualType/plugin');
    }

    private static function tag(array $config, ?\DOMDocument $document): array
    {
        if (!$document) return $config;
        // Mapper visits type and virtualType nodes in document order and
        // replaces a registration if the normalized result has the same key.
        foreach (self::nodes($document) as $node) {
            $target = $node->parentNode->getAttribute('name');
            $name = $node->getAttribute('name');
            if (!isset($config[$target]['plugins'][$name])) continue;
            $registration = &$config[$target]['plugins'][$name];
            foreach (['instance' => 'type', 'disabled' => 'disabled', 'sortOrder' => 'sortOrder'] as $key => $attribute) {
                unset($registration[self::ORIGIN . $key]);
                if (!array_key_exists($key, $registration)) continue;
                $owner = $node->getAttribute(self::ORIGIN . $attribute);
                // The converter supplies sortOrder=0 even for a partial
                // declaration in a new scope.
                if ($owner === '' && $key === 'sortOrder') $owner = $node->getAttribute(self::ORIGIN . 'name');
                if ($owner !== '') $registration[self::ORIGIN . $key] = $owner;
            }
            unset($registration);
        }
        return $config;
    }

    public static function origins(array $registration): array
    {
        return array_values(array_unique(array_intersect_key($registration, array_flip([
            self::ORIGIN . 'instance', self::ORIGIN . 'disabled', self::ORIGIN . 'sortOrder',
        ]))));
    }

    public static function signature(array $registrations): string
    {
        foreach ($registrations as &$plugin) {
            $plugin = array_filter($plugin, static fn($key) => !str_starts_with($key, self::ORIGIN), ARRAY_FILTER_USE_KEY);
        }
        return hash('sha256', Xml::canonical($registrations));
    }

    public static function chain(array $processed, string $subject, string $method): array
    {
        $segments = [];
        $code = '__self';
        while ($segment = $processed[$subject . '_' . lcfirst($method) . '_' . $code] ?? null) {
            if (isset($segments[$code])) throw new \RuntimeException('Cyclic Magento interception chain');
            ksort($segment);
            $segments[$code] = $segment;
            $code = $segment[DefinitionInterface::LISTENER_AROUND] ?? null;
            if ($code === null) break;
        }
        return $segments;
    }

    private static function candidateTypes(array $files, array $paths): array
    {
        $targets = [];
        foreach ($files as $file) foreach ($file['declarations'] as $item) {
            if ($item['family'] === 'plugins') $targets[$item['registration']['target']] = true;
        }
        foreach ($paths as $path) {
            if (!preg_match('~^src/app/code/(.+)/([A-Z][A-Za-z0-9_]*)\.php$~', $path, $match)
                || preg_match('~/(Test|Setup|node_modules|tailwind)/~', $path)) continue;
            $namespace = str_replace('/', '\\', $match[1]);
            $source = file_get_contents('/source/' . substr($path, 4));
            // Match the actual declaration before autoload. Registration
            // scripts and copied fixture files need not follow PSR conventions.
            $tokens = array_values(array_filter(\PhpToken::tokenize($source), static fn($token) => !$token->isIgnorable()));
            $declared = null;
            foreach ($tokens as $index => $token) {
                $name = $tokens[$index + 1] ?? null;
                if ($token->id === T_NAMESPACE) $declared = $name?->text;
                if ($token->id === T_CLASS && $declared === $namespace && $name?->id === T_STRING && $name->text === $match[2]) {
                    $targets[$namespace . '\\' . $name->text] = true;
                    break;
                }
            }
        }
        return array_keys($targets);
    }

    public static function prepare($om, array &$files, array $paths): array
    {
        $known = $items = $sourcePaths = $sourceHashes = [];
        foreach ($files as $path => &$file) {
            if ($file['family'] !== 'plugins') continue;
            foreach ($file['declarations'] as &$item) {
                $known[BP . '/' . $path][$item['node']] = $item['id'];
                $items[$item['id']] = &$item;
                $sourcePaths[$item['id']] = BP . '/' . $path;
                $sourceHashes[$item['id']] = $file['sourceHash'];
            }
            unset($item);
        }
        unset($file);
        if (!$items) return [[], []];

        [$configs, $tagged, $sources, $providers] = self::sources($om->get(Dom::class), $known);
        foreach ($items as $id => $item) {
            $scope = $item['declaredScope']['type'];
            $hash = $sources[$scope][$sourcePaths[$id]] ?? null;
            if ($hash !== null && $hash !== $sourceHashes[$id]) {
                throw new \RuntimeException('Runtime DI XML differs from its inventoried source');
            }
        }
        $loader = $om->get(ConfigLoaderInterface::class);
        $live = $om->get(ConfigInterface::class);
        $generator = $om->get(PluginListGenerator::class);
        $developer = $loader instanceof \Magento\Framework\App\ObjectManager\ConfigLoader
            && $live instanceof \Magento\Framework\Interception\ObjectManager\Config\Developer;
        $compiled = glob(BP . '/generated/metadata/*|plugin-list.php');
        $classes = self::candidateTypes($files, $paths);
        $generatorType = $developer ? InlinePluginManifest::generator($live) : '';
        $runtime = [];
        foreach (self::AREAS as $area) {
            $scopes = $area === 'global' ? ['primary', 'global'] : ['primary', 'global', $area];
            $di = clone $live;
            $data = [];
            if ($developer) foreach ($scopes as $scope) $di->extend($configs[$scope]);
            foreach (InlinePluginManifest::scopeOrder($generatorType, $scopes) as $scope) {
                $data = $generator->merge($tagged[$scope], $data);
            }
            $listType = $developer ? $di->getOriginalInstanceType($di->getPreference(PluginListInterface::class)) : '';
            $supported = $developer && !$compiled && $listType === PluginList::class
                && InlinePluginManifest::supported($generatorType) && InlinePluginManifest::generator($di) === $generatorType;
            foreach ($items as $id => &$item) {
                $scope = $item['declaredScope']['type'];
                if ($scope !== 'global' && $scope !== $area) continue;
                ['target' => $target, 'name' => $name] = $item['registration'];
                $registration = $data[$target][$name] ?? [];
                $origins = self::origins($registration);
                $item['areas'][$area] = match (true) {
                    !$supported => self::outcome('unsupported', 'Compiled DI, custom plugin lists or unsupported interceptor generators are unmeasured'),
                    !isset($sources[$scope][$sourcePaths[$id]]) => self::outcome('unsupported', 'Declaration is inactive in the installed DI reader'),
                    !in_array($id, $origins, true) => self::outcome('overridden', 'Superseded by another declaration'),
                    !empty($registration['disabled']) => self::outcome('disabled', 'Effective Magento registration is disabled'),
                    count($origins) > 1 => self::outcome('ambiguous', 'Multiple declarations supply effective plugin attributes'),
                    default => self::outcome('unsupported', 'No supported callback on an inventoried interceptable subject'),
                };
            }
            unset($item);
            if (!$supported) continue;

            $areaGenerator = clone $generator;
            (new \ReflectionProperty(PluginListGenerator::class, 'omConfig'))->setValue($areaGenerator, $di);
            $inherited = $processed = $subjects = [];
            foreach ($classes as $type) {
                // Also include concrete implementations selected through
                // preferences and virtual types in the effective area.
                $subjects[$type] = true;
                $subjects[$di->getOriginalInstanceType($di->getPreference($type))] = true;
            }
            $validator = new InterceptableValidator();
            foreach (array_keys($subjects) as $subject) {
                if (!class_exists($subject) || !$validator->validate($subject)) continue;
                $reflection = new \ReflectionClass($subject);
                if ($reflection->isFinal() || $reflection->isAbstract() || $di->getOriginalInstanceType($subject) !== $subject) continue;
                $areaGenerator->inheritPlugins($subject, $data, $inherited, $processed);
                $registrations = $inherited[$subject] ?? [];
                foreach ($registrations as $name => $registration) {
                    $origins = self::origins($registration);
                    if (count($origins) > 1 || !empty($registration['disabled'])) {
                        foreach ($origins as $id) {
                            // A registration inherited onto all of its concrete
                            // subjects can lack a unique origin even though the
                            // direct type declaration has one.
                            if (($items[$id]['areas'][$area]['status'] ?? null) !== 'unsupported') continue;
                            $items[$id]['areas'][$area] = !empty($registration['disabled'])
                                ? self::outcome('disabled', 'Inherited Magento registration is disabled')
                                : self::outcome('ambiguous', 'Multiple declarations supply inherited plugin attributes');
                        }
                        continue;
                    }
                    if (!$origins || !isset($items[$origins[0]])) continue;
                    $id = $origins[0];
                    $item = &$items[$id];
                    if (!isset($item['areas'][$area]) || !isset($sources[$item['declaredScope']['type']][$sourcePaths[$id]])) continue;
                    $implementation = $di->getOriginalInstanceType($di->getPreference($registration['instance']));
                    foreach ($reflection->getMethods(\ReflectionMethod::IS_PUBLIC) as $method) {
                        if ($method->isFinal() || $method->isStatic() || $method->isInternal() || $method->isConstructor()
                            || $method->isDestructor() || in_array($method->name, ['__sleep', '__wakeup', '__clone', '_resetState'], true)) continue;
                        $chain = self::chain($processed, $subject, $method->name);
                        foreach ($chain as $segment) foreach (self::PHASES as $listener => $phase) {
                            if (!in_array($name, (array) ($segment[$listener] ?? []), true)) continue;
                            $callback = $phase . ucfirst($method->name);
                            if (!method_exists($implementation, $callback)) continue;
                            $body = new \ReflectionMethod($implementation, $callback);
                            if (!$body->isPublic() || $body->isAbstract() || $body->isStatic() || $body->isInternal()) continue;
                            $identity = ['subject' => $subject, 'method' => $method->name, 'phase' => $phase];
                            $key = self::callbackKey($identity);
                            if ($item['areas'][$area]['status'] !== 'eligible') $item['areas'][$area] = self::outcome('eligible', null);
                            $item['areas'][$area]['callbacks'][$key] = $identity;
                            $runtime[$area][$subject]['signature'] ??= self::signature($registrations);
                            $runtime[$area][$subject]['chains'][$method->name] = $chain;
                            $runtime[$area][$subject]['targets'][$name][$method->name][$phase] = [
                                'id' => $id, 'implementation' => $implementation, 'class' => $body->class, 'callback' => $body->name,
                            ];
                        }
                    }
                    unset($item);
                }
            }
        }
        if ($runtime) {
            self::checkCaches($om->get(PluginListInterface::class), $runtime, $loader, $configs);
            InlinePluginManifest::prepare($om, $runtime);
        }
        foreach ($items as &$item) {
            $item['areas'] ??= [$item['declaredScope']['type'] => self::outcome('unsupported', 'Configuration scope is outside HTTP plugin coverage')];
            $item['supported'] = in_array('eligible', array_column($item['areas'], 'status'), true);
            $item['effective'] = $item['supported'];
        }
        unset($item);
        return [$runtime, $providers];
    }

    public static function validateList(PluginList $list, array $expected, array $snapshot): void
    {
        [$data, $inherited, $processed] = $snapshot;
        $processed ??= [];
        $generator = self::property($list, 'pluginListGenerator');
        foreach ($expected as $subject => $entry) {
            if (!array_key_exists($subject, $inherited)) {
                // Cold developer-mode lists populate these entries on demand.
                // Working copies keep verification out of application state.
                $generator->inheritPlugins($subject, $data, $inherited, $processed);
            }
            if (self::signature($inherited[$subject] ?? []) !== $entry['signature']) {
                throw new \RuntimeException('Magento plugin registrations differ from XML provenance; use --refresh-cache');
            }
            foreach ($entry['chains'] as $method => $chain) {
                if (self::chain($processed, $subject, $method) !== $chain) {
                    throw new \RuntimeException('Magento plugin chains differ from XML provenance; use --refresh-cache');
                }
            }
        }
    }

    public static function property(PluginList $list, string $name): mixed
    {
        static $properties = [];
        $property = $properties[$name] ??= new \ReflectionProperty(PluginList::class, $name);
        return $property->getValue($list);
    }

    private static function checkCaches(PluginList $list, array $runtime, ConfigLoaderInterface $loader, array $configs): void
    {
        $cache = self::property($list, '_cache');
        $cacheId = self::property($list, '_cacheId');
        $serializer = self::property($list, 'serializer');
        foreach ($runtime as $area => $subjects) {
            if ($loader->load($area) !== $configs[$area]) {
                throw new \RuntimeException('Cached Magento DI differs from current XML provenance; use --refresh-cache');
            }
            // Magento and Mage-OS use different names for the same scope set.
            // Only validate cached types actually materialized in each entry.
            $scopes = $area === 'global' ? ['primary', 'global'] : ['primary', 'global', $area];
            $natural = implode('|', $scopes);
            sort($scopes);
            foreach (array_unique([$natural, implode('|', $scopes)]) as $key) {
                $cached = $cache->load($key . '|' . $cacheId);
                if (!$cached) continue;
                $snapshot = $serializer->unserialize($cached);
                $materialized = array_intersect_key($subjects, $snapshot[1]);
                self::validateList($list, $materialized, $snapshot);
            }
        }
    }

    private static function outcome(string $status, ?string $reason): array
    {
        return ['status' => $status, 'reason' => $reason, 'callbacks' => []];
    }

    public static function callbackKey(array $identity): string
    {
        return hash('sha256', json_encode(array_values($identity), JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }
}
