<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
require_once __DIR__ . '/xml-data.php';
use MageLens\XmlCoverage\Xml;

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

function xmlManifest($om, array $run): array
{
    $files = []; $ids = []; $providers = [];
    foreach ($run['sources'] as $source => $hash) {
        if (!str_ends_with($source, '.xml') || preg_match('~/(Test|Setup|node_modules|tailwind)/~', $source)) continue;
        $path = substr($source, 4);
        $bytes = file_get_contents('/source/' . $path);
        if (hash('sha256', $bytes) !== $hash) throw new RuntimeException('XML source changed after preparation');
        $family = preg_match('~/etc/config\.xml$~', $path) ? 'config' : (preg_match('~/etc/adminhtml/system\.xml$~', $path) ? 'system' : null);
        $declarations = $family ? Xml::declarations($path, $bytes, $family) : [];
        $files[$path] = ['path' => $path, 'sourceHash' => $hash, 'family' => $family,
            'reason' => $declarations ? null : 'Unsupported XML family, location or schema', 'declarations' => $declarations];
        foreach ($declarations as $item) $ids[$item['id']] = true;
    }
    // Clone the installed reader, changing only its input resolver. Its actual
    // DOM merge, converter and scope-priority scheme remain authoritative.
    $reader = clone $om->get(\Magento\Framework\App\Config\Initial\Reader::class);
    $property = new ReflectionProperty($reader, '_fileResolver');
    $originalResolver = $property->getValue($reader);
    $resolver = new class($originalResolver, $files) implements \Magento\Framework\Config\FileResolverInterface {
        public array $providers = [];
        private array $seen = [];
        public function __construct(private $resolver, private array $files) {}
        public function get($filename, $scope = null)
        {
            $result = [];
            foreach ($this->resolver->get($filename, $scope) as $file => $source) {
                $this->providers[$file] = hash('sha256', $source);
                $path = str_starts_with($file, BP . '/') ? substr($file, strlen(BP) + 1) : $file;
                $dom = Xml::document($source);
                $known = [];
                foreach ($this->files[$path]['declarations'] ?? [] as $item) $known[$item['node']] = $item['id'];
                foreach ((new DOMXPath($dom))->query('/config/default//*[not(*)] | /config/websites/*//*[not(*)] | /config/stores/*//*[not(*)]') as $node) {
                    $empty = true;
                    foreach ($node->childNodes as $child) if ($child instanceof DOMCdataSection || trim($child->textContent) !== '') $empty = false;
                    $nodeKey = $node->getNodePath();
                    // Magento's DOM merge retains an existing value for an empty
                    // overriding node. Keep that behavior in the symbolic input.
                    if ($empty && isset($this->seen[$nodeKey])) continue;
                    $this->seen[$nodeKey] = true;
                    $id = $known[$node->getNodePath()] ?? hash('sha256', "$path\0" . $node->getNodePath());
                    while ($node->firstChild) $node->removeChild($node->firstChild);
                    $node->appendChild($dom->createTextNode($id));
                }
                $result[$file] = $dom->saveXML();
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
    $scopes = ['default' => ['' => '']];
    $stores = $om->get(\Magento\Store\Model\StoreManagerInterface::class);
    foreach ($stores->getWebsites(true) as $website) $scopes['websites'][(string) $website->getId()] = $website->getCode();
    foreach ($stores->getStores(true) as $store) $scopes['stores'][(string) $store->getId()] = $store->getCode();
    ksort($providers); ksort($files);
    // Public method shape guards. Unsupported versions fail preparation explicitly.
    foreach ([\Magento\Framework\App\Config::class => ['getValue', 'isSetFlag'],
        \Magento\Config\Model\Config\Structure\AbstractElement::class => ['getData'],
        \Magento\Config\Block\System\Config\Form\Field::class => ['render']] as $class => $methods) {
        foreach ($methods as $method) if (!(new ReflectionMethod($class, $method))->isPublic()) throw new RuntimeException('Unsupported XML hook method');
    }
    $manifest = ['schemaVersion' => 1, 'run' => $run['id'], 'files' => array_values($files), 'origins' => $origins,
        'fields' => array_filter($fields, static fn($items) => count($items) === 1), 'scopes' => $scopes,
        'runtime' => ['php' => PHP_VERSION, 'opentelemetry' => phpversion('opentelemetry')],
        'providers' => $providers, 'fieldHashes' => $fieldHashes, 'valueHashes' => $valueHashes, 'configuration' => xmlFingerprint($om)];
    $manifest['id'] = hash('sha256', json_encode($manifest, JSON_THROW_ON_ERROR));
    return $manifest;
}

if (realpath($_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    require '/var/www/html/app/bootstrap.php';
    $om = \Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
    $run = json_decode(file_get_contents('/coverage/run.json'), true, flags: JSON_THROW_ON_ERROR);
    $manifest = xmlManifest($om, $run);
    if (($argv[1] ?? '') === 'check') {
        $previous = json_decode(file_get_contents('/coverage/xml-manifest.json'), true, flags: JSON_THROW_ON_ERROR);
        if ($manifest !== $previous) throw new RuntimeException('XML configuration, scope or provenance changed during collection');
    } else {
        file_put_contents('/coverage/xml-manifest.json', json_encode($manifest, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
        $paths = ['' => true];
        $fields = [];
        foreach ($manifest['files'] as $file) foreach ($file['declarations'] as $item) {
            if (!$item['supported']) continue;
            if ($item['family'] === 'config') {
                $parts = explode('/', $item['path']);
                while ($parts) { $paths[implode('/', $parts)] = true; array_pop($parts); }
            } else $fields[$item['path']] = [$item['id']];
        }
        $compact = array_intersect_key($manifest, array_flip(['run', 'id', 'origins', 'scopes', 'fieldHashes']));
        $compact['paths'] = $paths; $compact['fields'] = $fields;
        $compact['originScopes'] = [];
        $compact['valueHashes'] = [];
        foreach ($manifest['origins'] as $key => $id) {
            $parts = explode('/', $key);
            $scope = array_shift($parts);
            if ($scope !== 'default') $scope .= '/' . array_shift($parts);
            $leaf = implode('/', $parts);
            $compact['originScopes'][$scope][$leaf] = $id;
            $compact['valueHashes'][$scope][$leaf] = $manifest['valueHashes'][$key];
        }
        unset($compact['origins']);
        file_put_contents('/coverage/xml-collector.json', json_encode($compact, JSON_THROW_ON_ERROR));
    }
}
