<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
require_once __DIR__ . '/xml-data.php';
require_once __DIR__ . '/xml-layout-manifest.php';
require_once __DIR__ . '/xml-observer-manifest.php';
require_once __DIR__ . '/xml-plugin-manifest.php';
require_once __DIR__ . '/xml-preference-manifest.php';
use MageLens\XmlCoverage\{Xml, LayoutManifest, ObserverManifest, PluginManifest, PreferenceManifest};

function xmlFingerprint($om): string
{
    $resource = $om->get(\Magento\Framework\App\ResourceConnection::class);
    $db = $resource->getConnection();
    $data = [];
    foreach (['core_config_data' => 'config_id', 'store' => 'store_id', 'store_website' => 'website_id'] as $table => $id) {
        $data[$table] = $db->fetchAll($db->select()->from($resource->getTableName($table))->order($id));
    }
    foreach (['app/etc/config.php', 'app/etc/env.php', 'composer.lock'] as $file) $data[$file] = hash_file('sha256', BP . '/' . $file);
    // Hash environment overrides without exposing their names or values.
    $data['environment'] = array_filter(getenv(), static fn($key) => str_starts_with($key, 'CONFIG__') || str_starts_with($key, 'MAGENTO_DC__'), ARRAY_FILTER_USE_KEY);
    ksort($data['environment']);
    return hash('sha256', json_encode($data, JSON_THROW_ON_ERROR));
}

function prepareXmlManifests($om, array $run): array
{
    $files = []; $ids = []; $providers = [];
    foreach ($run['sources'] as $source => $hash) {
        if (!str_ends_with($source, '.xml') || preg_match('~/(Test|Setup|node_modules|tailwind)/~', $source)) continue;
        $path = substr($source, 4);
        $bytes = file_get_contents('/source/' . $path);
        if (hash('sha256', $bytes) !== $hash) throw new RuntimeException('XML source changed after preparation');
        $family = match (true) {
            (bool) preg_match('~/etc/config\.xml$~', $path) => 'config',
            (bool) preg_match('~/etc/adminhtml/system\.xml$~', $path) => 'system',
            (bool) preg_match('~/etc/(?:[^/]+/)?events\.xml$~', $path) => 'events',
            (bool) preg_match('~/etc/(?:[^/]+/)?di\.xml$~', $path) => 'plugins',
            LayoutManifest::isLayout($path) => 'layout',
            default => null,
        };
        $declarations = match ($family) {
            'layout' => LayoutManifest::declarations($path, $bytes),
            null => [],
            default => Xml::declarations($path, $bytes, $family),
        };
        if ($family === 'plugins') foreach (['preferences', 'virtual-types', 'arguments', 'lifecycles'] as $diFamily) {
            $declarations = array_merge($declarations, Xml::declarations($path, $bytes, $diFamily));
        }
        $files[$path] = ['path' => $path, 'sourceHash' => $hash, 'family' => $family,
            'reason' => $declarations ? null : 'Unsupported XML family, location or schema', 'declarations' => $declarations];
        if ($family === 'config') foreach ($declarations as $item) $ids[$item['id']] = true;
    }
    // Clone the installed reader, changing only its input resolver. Its actual
    // DOM merge, converter and scope-priority scheme remain authoritative.
    $reader = clone $om->get(\Magento\Framework\App\Config\Initial\Reader::class);
    $property = new ReflectionProperty($reader, '_fileResolver');
    $originalResolver = $property->getValue($reader);
    $sources = []; $known = [];
    $filename = (new ReflectionProperty($reader, '_fileName'))->getValue($reader);
    foreach ((new ReflectionProperty($reader, '_scopePriorityScheme'))->getValue($reader) as $scope) {
        foreach ($originalResolver->get($filename, $scope) as $file => $source) $sources[$file] = $source;
    }
    foreach ($files as $path => $file) foreach ($file['declarations'] as $item) $known[BP . '/' . $path][$item['node']] = $item['id'];
    $substitution = Xml::symbolicSources($sources, $known);
    foreach ($files as &$file) if ($file['family'] === 'config') foreach ($file['declarations'] as &$item) {
        if (isset($substitution['unmeasured'][$item['node']])) {
            $item['supported'] = false; $item['reason'] = $substitution['unmeasured'][$item['node']];
            unset($ids[$item['id']]);
        }
    }
    unset($file, $item);
    $resolver = new class($originalResolver, $sources, $substitution['sources']) implements \Magento\Framework\Config\FileResolverInterface {
        public array $providers = [];
        public function __construct(private $resolver, private array $originals, private array $symbolic) {}
        public function get($filename, $scope = null)
        {
            $result = [];
            foreach ($this->resolver->get($filename, $scope) as $file => $source) {
                $this->providers[$file] = hash('sha256', $source);
                if (($this->originals[$file] ?? null) !== $source) throw new RuntimeException('XML providers changed during provenance preparation');
                $result[$file] = $this->symbolic[$file];
            }
            return $result;
        }
    };
    $property->setValue($reader, $resolver);
    $symbolic = $reader->read()['data'];
    $providers = $resolver->providers;
    // Follow the installed aggregate's ordered source list. Every non-modular
    // provider masks XML ownership, including custom/equal-valued overrides.
    $aggregate = $om->get('systemConfigSourceAggregated');
    $sourceProperty = new ReflectionProperty(\Magento\Framework\App\Config\ConfigSourceAggregated::class, 'sources');
    $aggregateSources = $sourceProperty->getValue($aggregate);
    $modular = $symbolic; $symbolic = [];
    foreach ($aggregateSources as $entry) {
        $source = $entry['source'];
        $class = get_class($source);
        $isModular = in_array($class, [\Magento\Config\App\Config\Source\ModularConfigSource::class,
            \Magento\Config\App\Config\Source\ModularConfigSource::class . '\\Interceptor'], true);
        if ($isModular && $om->get(\Magento\Framework\Interception\PluginListInterface::class)->getNext(\Magento\Config\App\Config\Source\ModularConfigSource::class, 'get')) $isModular = false;
        $data = $isModular ? $modular : Xml::mask($source->get() ?? []);
        $symbolic = array_replace_recursive($symbolic, $data);
    }
    // Use the platform preprocessor and fallback for scope inheritance, including
    // case/code aliases and environment overrides; retain only known origin IDs.
    $symbolic = $om->get(\Magento\Framework\App\Config\PreProcessorComposite::class)->process($symbolic);
    $symbolic = $om->get(\Magento\Store\Model\Config\Processor\Fallback::class)->process($symbolic);
    $origins = [];
    foreach (Xml::leaves($symbolic) as $key => $id) if (is_string($id) && isset($ids[$id])) $origins[$key] = $id;
    ksort($origins);

    // Compare observed cached values against a fresh read through the platform's
    // own processors. A stale cache cannot credit a newly edited XML declaration.
    $fresh = $om->get(\Magento\Config\App\Config\Type\System\Reader::class)->read();
    $fresh = $om->get('systemConfigPostProcessorComposite')->process($fresh);
    $freshLeaves = Xml::leaves($fresh);
    $valueHashes = [];
    foreach ($origins as $key => $id) {
        $valueHashes[$key] = hash('sha256', json_encode($freshLeaves[$key] ?? null, JSON_THROW_ON_ERROR));
    }

    $fields = []; $activeSystem = [];
    foreach (['global', 'adminhtml'] as $scope) foreach ($originalResolver->get('system.xml', $scope) as $file => $source) {
        $providers[$file] = hash('sha256', $source);
        $path = str_starts_with($file, BP . '/') ? substr($file, strlen(BP) + 1) : $file;
        $activeSystem[$path] = true;
        foreach (Xml::declarations($path, $source, 'system') as $item) $fields[$item['path']][] = $item['id'];
    }
    $structure = $om->get(\Magento\Config\Model\Config\Structure\Reader::class)->read('adminhtml');
    $fieldHashes = [];
    $effectiveIds = array_fill_keys(array_values($origins), true);
    foreach ($files as $path => &$file) foreach ($file['declarations'] as &$item) {
        if ($file['family'] === 'layout') continue;
        if ($file['family'] === 'config' && !isset($providers[BP . '/' . $path])) {
            $item['supported'] = false; $item['reason'] = 'Not consumed by the installed initial configuration reader';
        }
        if ($file['family'] === 'system') {
            if (!isset($activeSystem[$path]) || count($fields[$item['path']] ?? []) !== 1) {
                $item['supported'] = false; $item['reason'] = 'Inactive or multiply contributed field: precise metadata provenance is unmeasured';
            } else {
                $node = (new DOMXPath(Xml::document(file_get_contents('/source/' . $path))))->query($item['node'])->item(0);
                if ($node->hasAttribute('extends') || $node->ownerDocument->getElementsByTagName('include')->length) {
                    $item['supported'] = false; $item['reason'] = 'Inherited or included field metadata is unmeasured';
                }
                foreach (['frontend_model', 'include'] as $tag) if ($node->getElementsByTagName($tag)->length) {
                    $item['supported'] = false; $item['reason'] = 'Custom field rendering is not measured by this adapter';
                }
            }
        }
        if ($file['family'] === 'system' && $item['supported']) {
            $parts = explode('/', $item['path']);
            $data = $structure['config']['system']['sections'][array_shift($parts)] ?? [];
            foreach ($parts as $part) $data = $data['children'][$part] ?? [];
            if ($data) $fieldHashes[$item['path']] = hash('sha256', Xml::canonical($data));
            else { $item['supported'] = false; $item['reason'] = 'Field missing from the fresh platform structure'; }
        }
        $item['effective'] = $file['family'] === 'system' ? $item['supported'] : isset($effectiveIds[$item['id']]);
    }
    unset($file, $item);
    $areas = Xml::enabledHttpAreas($om->get(\Magento\Framework\App\AreaList::class)->getCodes());
    [$observers, $eventProviders] = ObserverManifest::prepare($om, $files, $areas);
    $providers += $eventProviders;
    $scopes = ['default' => ['' => '']];
    $stores = $om->get(\Magento\Store\Model\StoreManagerInterface::class);
    foreach ($stores->getWebsites(true) as $website) $scopes['websites'][(string) $website->getId()] = $website->getCode();
    foreach ($stores->getStores(true) as $store) $scopes['stores'][(string) $store->getId()] = $store->getCode();
    $scopeCodes = [];
    foreach (['websites', 'stores'] as $type) $scopeCodes[$type] = array_fill_keys(array_keys($fresh[$type] ?? []), true);
    [$preferences, $snapshots] = PreferenceManifest::prepare($om, $files, $areas);
    [$plugins, $pluginProviders] = PluginManifest::prepare($om, $files, array_keys($run['sources']), snapshots: $snapshots, areas: $areas);
    $providers += $snapshots[3] ?? [];
    $providers += $pluginProviders;
    ksort($providers); ksort($files);
    // Public method shape guards. Unsupported versions fail preparation explicitly.
    foreach ([\Magento\Framework\App\Config::class => ['getValue', 'isSetFlag'],
        \Magento\Backend\App\Config::class => ['getValue', 'isSetFlag'],
        \Magento\Config\App\Config\Type\System::class => ['get'],
        \Magento\Config\Model\Config\Structure\AbstractElement::class => ['getData'],
        \Magento\Config\Block\System\Config\Form\Field::class => ['render']] as $class => $methods) {
        foreach ($methods as $method) if (!(new ReflectionMethod($class, $method))->isPublic()) throw new RuntimeException('Unsupported XML hook method');
    }
    return xmlManifestPayloads(
        [
            'run' => $run['id'],
            'observers' => $observers,
            'plugins' => $plugins,
            'preferences' => $preferences,
            'layoutSources' => LayoutManifest::targets($files),
            'scopes' => $scopes,
            'scopeCodes' => $scopeCodes,
            'fieldHashes' => $fieldHashes,
        ],
        [
            'schemaVersion' => 1,
            'files' => array_values($files),
            'origins' => $origins,
            'fields' => array_filter($fields, static fn($items) => count($items) === 1),
            'runtime' => ['php' => PHP_VERSION, 'opentelemetry' => phpversion('opentelemetry')],
            'providers' => $providers,
            'valueHashes' => $valueHashes,
            'configuration' => xmlFingerprint($om),
        ]
    );
}

function xmlManifestPayloads(array $shared, array $report): array
{
    $manifest = $shared + $report;
    $id = hash('sha256', json_encode($manifest, JSON_THROW_ON_ERROR));
    $manifest['id'] = $id;
    $collector = $shared + [
        'id' => $id,
        'paths' => ['' => true],
        'fields' => [],
        'originScopes' => [],
        'valueHashes' => [],
    ];

    foreach ($report['files'] as $file) {
        foreach ($file['declarations'] as $item) {
            if (!$item['supported']) continue;
            if ($item['family'] === 'config') {
                $parts = explode('/', $item['path']);
                while ($parts) {
                    $collector['paths'][implode('/', $parts)] = true;
                    array_pop($parts);
                }
            } elseif ($item['family'] === 'system') {
                $collector['fields'][$item['path']] = [$item['id']];
            }
        }
    }
    foreach ($report['origins'] as $key => $originId) {
        [$scope, $leaf] = explode('/', $key, 2);
        if ($scope !== 'default') {
            [$code, $leaf] = explode('/', $leaf, 2);
            $scope .= '/' . $code;
        }
        $collector['originScopes'][$scope][$leaf] = $originId;
        $collector['valueHashes'][$scope][$leaf] = $report['valueHashes'][$key];
    }

    return [$manifest, $collector];
}

if (realpath($_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    require '/var/www/html/app/bootstrap.php';
    $om = \Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
    $run = json_decode(file_get_contents('/coverage/run.json'), true, flags: JSON_THROW_ON_ERROR);
    [$manifest, $collector] = prepareXmlManifests($om, $run);
    if (($argv[1] ?? '') === 'check') {
        $previous = json_decode(file_get_contents('/coverage/xml-manifest.json'), true, flags: JSON_THROW_ON_ERROR);
        if ($manifest !== $previous) throw new RuntimeException('XML configuration, scope or provenance changed during collection');
    } else {
        file_put_contents('/coverage/xml-manifest.json', json_encode($manifest, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
        file_put_contents('/coverage/xml-collector.json', json_encode($collector, JSON_THROW_ON_ERROR));
    }
}
