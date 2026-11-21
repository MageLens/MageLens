<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\Config\AbstractXml;
use Magento\Framework\Config\Dom;
use Magento\Framework\Config\Reader\Filesystem;
use Magento\Framework\Config\FileIterator;
use Magento\Framework\Config\Data as ConfigData;
use Magento\Framework\View\Layout\PageType\Config as PageTypes;
use Magento\Framework\View\Layout\PageType\Config\Reader as TypeReader;
use Magento\Framework\View\Layout\PageType\Config\Converter as TypeConverter;
use Magento\Framework\View\PageLayout\Config;
use Magento\Framework\View\PageLayout\File\Collector\Aggregated;
use Magento\Theme\Model\PageLayout\Config\Builder;

final class LayoutRegistryCoverage
{
    private array $builders = [];
    private \WeakMap $builderReads;
    private array $reading = [];
    private array $merging = [];
    private array $interpreting = [];
    private \WeakMap $nodes;
    private array $retained = [];
    private array $parents = [];
    private \WeakMap $configs;
    private array $errors = [];
    private array $limitations = [];
    private bool $disabled = false;
    private bool $healthy = false;
    private array $dataConstruction = [];
    private \WeakMap $typeStorage;
    private \WeakMap $typeStorageLimits;
    private \WeakMap $typeObjects;
    private array $typeInitialization = [];

    public function __construct(
        private readonly array $sources,
        private readonly \Closure $context,
        private readonly \Closure $event
    ) {
        $this->builderReads = new \WeakMap();
        $this->nodes = new \WeakMap();
        $this->configs = new \WeakMap();
        $this->typeStorage = new \WeakMap();
        $this->typeStorageLimits = new \WeakMap();
        $this->typeObjects = new \WeakMap();
    }

    public function hooks(): array
    {
        return [
            [Builder::class, 'getPageLayoutsConfig', $this->beginBuilder(...), $this->completeBuilder(...)],
            [Aggregated::class, 'getFilesContent', null, $this->filesRead(...)],
            [AbstractXml::class, '_merge', $this->beginRead(...), $this->completeRead(...)],
            [Dom::class, '__construct', $this->beginMerge(...), $this->completeMerge(...)],
            [Dom::class, 'merge', $this->beginMerge(...), $this->completeMerge(...)],
            [Dom::class, '_initDom', null, $this->inputDocument(...)],
            [Dom::class, '_mergeNode', $this->beginNode(...), $this->completeNode(...)],
            [Dom::class, '_getNodePathByParent', null, $this->nodePath(...)],
            [Dom::class, '_getMatchedNode', null, $this->matchedNode(...)],
            [Dom::class, '_isTextNode', null, $this->textBranch(...)],
            [Dom::class, 'replaceCdataNode', null, $this->cdataWritten(...)],
            [\DOMDocument::class, 'importNode', null, $this->imported(...)],
            [\DOMElement::class, 'setAttribute', null, $this->attributeWritten(...)],
            [Config::class, '_extractData', null, $this->extracted(...)],
            [Config::class, 'hasPageLayout', null, $this->membership(...)],
            [Config::class, 'toOptionArray', null, $this->options(...)],
            [Config::class, 'getOptions', null, $this->snapshotReturned(...)],
            [Filesystem::class, '_readFiles', $this->beginTypes(...), $this->completeTypes(...)],
            [FileIterator::class, 'current', null, $this->typeFile(...)],
            [TypeConverter::class, 'convert', null, $this->typesConverted(...)],
            [ConfigData::class, '__construct', $this->beginData(...), $this->completeData(...)],
            [ConfigData::class, 'reset', $this->beginData(...), $this->completeData(...)],
            [ConfigData::class, 'get', null, $this->typesData(...)],
            [ConfigData::class, 'merge', $this->typeDataChanged(...), null],
            [PageTypes::class, '_initPageTypes', $this->beginTypeInitialization(...), $this->completeTypeInitialization(...)],
            [\Magento\Framework\DataObject::class, 'getData', null, $this->typeValueRead(...)],
            [\Magento\Framework\DataObject::class, 'setData', null, $this->typeObjectChanged(...)],
            [\Magento\Framework\DataObject::class, 'unsetData', null, $this->typeObjectChanged(...)],
            [\Magento\Framework\DataObject::class, 'offsetSet', null, $this->typeObjectChanged(...)],
            [\Magento\Framework\DataObject::class, 'offsetUnset', null, $this->typeObjectChanged(...)],
            [\ReflectionProperty::class, 'setValue', null, $this->replaced(...)],
            [\ReflectionProperty::class, 'setRawValue', null, $this->replaced(...)],
            [\ReflectionProperty::class, 'setRawValueWithoutLazyInitialization', null, $this->replaced(...)],
        ];
    }

    public function finish(): array
    {
        if ($this->errors) throw new \RuntimeException(implode('; ', array_keys($this->errors)));
        return [$this->healthy, array_keys($this->limitations)];
    }

    private static function caller(): array
    {
        return LayoutRuntimeHooks::trace(DEBUG_BACKTRACE_IGNORE_ARGS, 4)[3] ?? [];
    }

    private function beginBuilder($builder, array $params, string $class): void
    {
        if ($class !== Builder::class) return;
        $valid = get_class($builder) === Builder::class;
        $this->builders[] = ['object' => $builder, 'valid' => $valid, 'reads' => $this->builderReads[$builder] ?? []];
        if (!$valid) $this->limitations['layout-registry-custom-provider'] = true;
    }

    private function completeBuilder($builder, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Builder::class) return;
        $frame = array_pop($this->builders);
        if (!$error && $frame['valid']) $this->builderReads[$builder] = $frame['reads'];
    }

    private function filesRead($collector, array $params, $contents, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->builders);
        if ($this->disabled || $error || $class !== Aggregated::class || $index === null
            || !$this->builders[$index]['valid'] || !is_array($contents)) return;
        $bytes = 0;
        foreach ($contents as $path => $content) {
            $bytes += strlen($content);
            if ($bytes > 2097152 || (!isset($this->builders[$index]['reads'][$path])
                && count($this->builders[$index]['reads']) >= 512)) { $this->limit(); return; }
            $hash = hash('sha256', $content);
            $relative = str_starts_with($path, BP . '/') ? substr($path, strlen(BP) + 1) : '';
            $source = $this->sources[$relative] ?? null;
            if ($source && ($source['hash'] !== $hash || realpath($path) !== $path)) {
                $this->errors['Registry source changed or became a symlink after preparation'] = true;
            }
            $previous = $this->builders[$index]['reads'][$path] ?? $hash;
            if ($previous !== $hash) $this->errors['Registry source changed during native file collection'] = true;
            $this->builders[$index]['reads'][$path] = $hash;
        }
    }

    private function beginRead($config, array $params, string $class): void
    {
        if ($class !== AbstractXml::class) return;
        $builder = $this->builders[array_key_last($this->builders)] ?? null;
        $frame = null;
        if ($config instanceof Config) {
            unset($this->configs[$config]);
            if (get_class($config) === Config::class && $builder && $builder['valid'] && is_array($params[0])) {
                $files = [];
                $bytes = 0;
                foreach ($params[0] as $path => $content) {
                    if (!is_string($content)) break;
                    $bytes += strlen($content);
                    if (count($files) >= 512 || $bytes > 2097152) { $this->limit(); break; }
                    $hash = hash('sha256', $content);
                    $relative = str_starts_with($path, BP . '/') ? substr($path, strlen(BP) + 1) : '';
                    $source = $this->sources[$relative] ?? null;
                    if ($source && $source['hash'] !== $hash) $this->errors['Cached registry XML differs from prepared sources; use --refresh-cache'] = true;
                    $verified = ($builder['reads'][$path] ?? null) === $hash;
                    if (!$verified) $this->limitations['layout-registry-cache'] = true;
                    $files[] = ['hash' => $hash, 'targets' => $verified ? ($source['targets'] ?? []) : [],
                        'unconfirmed' => $verified ? [] : array_merge(...array_map(static fn($target) => array_values($target['ids']), $source['targets'] ?? []))];
                }
                if (count($files) !== count($params[0]) || count($files) > 512 || $bytes > 2097152) $this->limit();
                $frame = ['family' => 'registry', 'object' => $config, 'files' => $files, 'next' => 0, 'labels' => [], 'ids' => [], 'ignored' => [], 'unconfirmed' => []];
            } else $this->limitations['layout-registry-custom-provider'] = true;
        }
        $this->reading[] = $frame;
    }

    private function completeRead($config, array $params, $document, ?\Throwable $error, string $class): void
    {
        if ($class !== AbstractXml::class) return;
        $frame = array_pop($this->reading);
        if ($error || !$frame || !empty($frame['unsupported']) || $this->disabled || !$document instanceof \DOMDocument) return;
        if ($frame['next'] !== count($frame['files'])) {
            $this->errors['Missing native registry file merge evidence'] = true;
            return;
        }
        $rows = [];
        foreach ($document->getElementsByTagName('layout') as $layout) {
            $id = $layout->getAttribute('id');
            $label = $layout->getElementsByTagName('label')->item(0);
            if (!$label) continue;
            $metadata = $this->nodes[$layout] ?? [];
            $labelMetadata = $this->nodes[$label] ?? [];
            $value = trim($layout->nodeValue ?? '');
            $labels = $this->labelSources($label, $value, $labelMetadata);
            $rows[$id] = ['node' => $metadata['node'] ?? null, 'id' => $metadata['attributes']['id'] ?? null,
                'labels' => $labels, 'parent' => $metadata['parents']['id'] ?? null,
                'labelParents' => array_values(array_filter(array_map(fn($source) => $this->parents[$source] ?? null, $labels))),
                'labelUnconfirmed' => $labelMetadata['unconfirmed'] ?? false,
                'ignored' => $frame['ignored'][$id] ?? [],
                'allLabels' => $frame['labels'][$id] ?? [], 'allIds' => $frame['ids'][$id] ?? []];
        }
        $this->configs[$config] = ['rows' => $rows, 'unconfirmed' => array_values(array_unique($frame['unconfirmed'])), 'hash' => null];
    }

    private function beginMerge($merger, array $params, string $class): void
    {
        if ($class !== Dom::class) return;
        $scope = array_key_last($this->reading);
        $frame = null;
        $caller = self::caller();
        if (!$this->disabled && $scope !== null && $this->reading[$scope]) {
            $read = &$this->reading[$scope];
            $registry = $read['family'] === 'registry' && ($caller['class'] ?? null) === AbstractXml::class
                && ($caller['function'] ?? null) === '_merge';
            $types = $read['family'] === 'page-types' && ($caller['class'] ?? null) === Filesystem::class
                && in_array($caller['function'] ?? null, ['_createConfigMerger', '_readFiles'], true);
            if ($registry || $types) {
                $source = $registry ? ($read['files'][$read['next']++] ?? null) : ($read['pending'] ?? null);
                unset($read['pending']);
                if (get_class($merger) !== Dom::class) {
                    $read['unsupported'] = true;
                    $this->limitations['layout-registry-custom-provider'] = true;
                } elseif (!$source || $source['hash'] !== hash('sha256', $params[0])) {
                    $this->errors['Registry merge inputs lack native source identity'] = true;
                } else {
                    $read['unconfirmed'] = [...$read['unconfirmed'], ...$source['unconfirmed']];
                    $frame = ['object' => $merger, 'scope' => $scope, 'source' => $source];
                }
            }
        }
        $this->merging[] = $frame;
    }

    private function completeMerge($merger, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class === Dom::class) array_pop($this->merging);
    }

    private function inputDocument($merger, array $params, $document, ?\Throwable $error, string $class): void
    {
        $frame = $this->merging[array_key_last($this->merging)] ?? null;
        if ($error || $class !== Dom::class || !$frame || $frame['object'] !== $merger || !$document instanceof \DOMDocument) return;
        foreach ($document->getElementsByTagName('*') as $ordinal => $node) {
            $ids = $frame['source']['targets'][$ordinal]['ids'] ?? [];
            $metadata = ['node' => $ids['registry-entry'] ?? $ids['page-type'] ?? null,
                'attributes' => ['id' => $ids['registry-id'] ?? $ids['page-type-id'] ?? null,
                    'label' => $ids['page-type-label'] ?? null],
                'parents' => ['id' => $ids['registry-entry'] ?? null], 'label' => $ids['registry-label'] ?? null];
            $this->retain($node, $metadata);
            if ($node->tagName === 'type') {
                $id = $node->getAttribute('id');
                foreach (['page-type-id', 'page-type-label'] as $kind) {
                    if (isset($ids[$kind])) $this->reading[$frame['scope']]['fields'][$id][$ids[$kind]] = true;
                }
            }
            if ($node->tagName === 'label' && isset($ids['registry-label'])) {
                $id = $node->parentNode->getAttribute('id');
                $this->parents[$ids['registry-label']] = $this->nodes[$node->parentNode]['node'] ?? null;
                $this->reading[$frame['scope']]['labels'][$id][$ids['registry-label']] = true;
            }
            if (isset($ids['registry-id'])) {
                $id = $node->getAttribute('id');
                $this->reading[$frame['scope']]['ids'][$id][$ids['registry-id']] = true;
            }
        }
    }

    private function beginNode($merger, array $params, string $class): void
    {
        if ($class !== Dom::class) return;
        $active = $this->merging[array_key_last($this->merging)] ?? null;
        $valid = !$this->disabled && $active && $active['object'] === $merger && isset($this->nodes[$params[0]]);
        $this->interpreting[] = $valid ? ['object' => $merger, 'input' => $params[0], 'path' => null,
            'matchedSet' => false, 'matched' => null, 'children' => [], 'text' => false, 'imported' => false, 'cdata' => false] : null;
    }

    private function nodePath($merger, array $params, $path, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->interpreting);
        if (!$error && $class === Dom::class && $index !== null && $this->interpreting[$index]
            && $this->interpreting[$index]['input'] === $params[0]) $this->interpreting[$index]['path'] = $path;
    }

    private function matchedNode($merger, array $params, $node, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->interpreting);
        $frame = $index === null ? null : $this->interpreting[$index];
        if ($error || $class !== Dom::class || !$frame || $frame['matchedSet'] || $frame['path'] !== $params[0]) return;
        $this->interpreting[$index]['matchedSet'] = true;
        $this->interpreting[$index]['matched'] = $node;
        if ($node instanceof \DOMElement && $node->tagName === 'label') {
            $this->interpreting[$index]['children'] = iterator_to_array($node->childNodes);
        }
    }

    private function textBranch($merger, array $params, $isText, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->interpreting);
        if (!$error && $class === Dom::class && $isText && $index !== null && $this->interpreting[$index]
            && $this->interpreting[$index]['input'] === $params[0]) $this->interpreting[$index]['text'] = true;
    }

    private function cdataWritten($merger, array $params, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->interpreting);
        $frame = $index === null ? null : $this->interpreting[$index];
        if ($error || $class !== Dom::class || !$frame || $this->disabled
            || $frame['matched'] !== $params[0] || $frame['input'] !== $params[1]) return;
        $this->interpreting[$index]['cdata'] = true;
        $old = $new = null;
        foreach ($params[0]->childNodes as $node) {
            if ($node instanceof \DOMCdataSection) { $old = $node; break; }
        }
        foreach ($params[1]->childNodes as $node) {
            if ($node instanceof \DOMCdataSection) { $new = $node; break; }
        }
        $label = $this->nodes[$params[1]]['label'] ?? null;
        if ($old && $new) {
            $this->retain($old, ['text' => $label]);
            $metadata = $this->nodes[$params[0]] ?? [];
            $metadata['empty'] = $label;
            unset($metadata['unconfirmed']);
            $this->retain($params[0], $metadata);
        } elseif ($label !== null) {
            $active = $this->merging[array_key_last($this->merging)];
            $id = $params[1]->parentNode->getAttribute('id');
            $this->reading[$active['scope']]['ignored'][$id][$label] = true;
        }
    }

    private function imported($document, array $params, $copy, ?\Throwable $error, string $class): void
    {
        $frame = $this->interpreting[array_key_last($this->interpreting)] ?? null;
        $caller = self::caller();
        if ($error || $class !== \DOMDocument::class || !$frame || $this->disabled
            || ($caller['class'] ?? null) !== Dom::class || ($caller['function'] ?? null) !== '_mergeNode') return;
        $index = array_key_last($this->interpreting);
        $this->interpreting[$index]['imported'] = true;
        $this->copyOrigins($params[0], $copy);
    }

    private function copyOrigins(\DOMNode $source, \DOMNode $target, ?string $label = null): void
    {
        if ($this->disabled) return;
        $metadata = $this->nodes[$source] ?? [];
        if ($source instanceof \DOMElement && $source->tagName === 'label') {
            $label = $metadata['label'] ?? null;
            $metadata['empty'] = $label;
        }
        if ($source instanceof \DOMText) $metadata['text'] = $label;
        $this->retain($target, $metadata);
        foreach ($source->childNodes as $index => $child) $this->copyOrigins($child, $target->childNodes->item($index), $label);
    }

    private function attributeWritten($node, array $params, $result, ?\Throwable $error, string $class): void
    {
        $frame = $this->interpreting[array_key_last($this->interpreting)] ?? null;
        $caller = self::caller();
        if ($error || $class !== \DOMElement::class || !$frame || $this->disabled
            || ($caller['class'] ?? null) !== Dom::class || ($caller['function'] ?? null) !== '_mergeAttributes') return;
        $metadata = $this->nodes[$node] ?? [];
        $metadata['attributes'][$params[0]] = $this->nodes[$frame['input']]['attributes'][$params[0]] ?? null;
        $metadata['parents'][$params[0]] = $this->nodes[$frame['input']]['node'] ?? null;
        $this->retain($node, $metadata);
    }

    private function completeNode($merger, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Dom::class) return;
        $frame = array_pop($this->interpreting);
        if ($error || !$frame || $this->disabled) return;
        $input = $this->nodes[$frame['input']];
        if (!$frame['matched'] && !$frame['imported'] && array_filter([$input['node'], $input['label'], ...array_values($input['attributes'])])) {
            $this->errors['Missing native registry import hook evidence'] = true;
        }
        $node = $frame['matched'];
        if ($node instanceof \DOMElement && !empty($input['attributes']['id'])
            && ($this->nodes[$node]['attributes']['id'] ?? null) !== $input['attributes']['id']) {
            $this->errors['Missing native registry attribute hook evidence'] = true;
        }
        if (!$node instanceof \DOMElement || $node->tagName !== 'label' || $frame['cdata']) return;
        $input = $this->nodes[$frame['input']];
        $children = iterator_to_array($node->childNodes);
        $newText = array_filter($children, static fn($child) => $child instanceof \DOMText && !in_array($child, $frame['children'], true));
        $cleared = !$children && ($frame['children'] || $frame['text']);
        if (!$newText && !$cleared) {
            if (!$frame['input']->hasChildNodes()) {
                $active = $this->merging[array_key_last($this->merging)];
                $id = $frame['input']->parentNode->getAttribute('id');
                if ($input['label']) $this->reading[$active['scope']]['ignored'][$id][$input['label']] = true;
            } else {
                $onlyText = !array_filter([...$children, ...iterator_to_array($frame['input']->childNodes)],
                    static fn($child) => $child instanceof \DOMElement);
                if ($onlyText) $this->errors['Missing native registry CDATA hook evidence'] = true;
                $metadata = $this->nodes[$node] ?? [];
                $metadata['unconfirmed'] = true;
                $this->retain($node, $metadata);
                $this->limitations['layout-registry-complex-label'] = true;
            }
            return;
        }
        $metadata = $this->nodes[$node] ?? [];
        $metadata['empty'] = $input['label'] ?? null;
        unset($metadata['unconfirmed']);
        $this->retain($node, $metadata);
        foreach ($children as $child) {
            if ($child instanceof \DOMText) $this->retain($child, ['text' => $input['label'] ?? null]);
        }
    }

    private function retain(\DOMNode $node, array $metadata): void
    {
        if (!isset($this->nodes[$node])) {
            if (count($this->retained) >= 16384) { $this->limit(); return; }
            $this->retained[] = $node;
        }
        $this->nodes[$node] = $metadata;
    }

    private function limit(): void
    {
        $this->disabled = true;
        $this->limitations['layout-registry-limit'] = true;
    }

    private function labelSources(\DOMElement $label, string $value, array $metadata): array
    {
        if (!empty($metadata['unconfirmed'])) return [];
        if ($value === '') return array_values(array_filter([$metadata['empty'] ?? null]));
        $children = iterator_to_array($label->childNodes);
        $text = implode('', array_map(static fn($node) => $node instanceof \DOMText ? $node->nodeValue : '', $children));
        if (trim($text) !== $value) return [];
        $start = strlen($text) - strlen(ltrim($text));
        $end = strlen(rtrim($text));
        $offset = 0;
        $ids = [];
        foreach ($children as $child) {
            if (!$child instanceof \DOMText) continue;
            $next = $offset + strlen($child->nodeValue);
            if ($offset < $end && $next > $start && isset($this->nodes[$child]['text'])) $ids[] = $this->nodes[$child]['text'];
            $offset = $next;
        }
        return array_values(array_unique($ids));
    }

    private function extracted($config, array $params, $data, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== Config::class || !isset($this->configs[$config])) return;
        $state = $this->configs[$config];
        $state['hash'] = is_array($data) ? Xml::scalarTreeSignature($data) : null;
        $this->configs[$config] = $state;
    }

    private function state(Config $config): ?array
    {
        if ($this->disabled || !isset($this->configs[$config])) return null;
        $state = $this->configs[$config];
        static $data;
        $data ??= new \ReflectionProperty(AbstractXml::class, '_data');
        $value = $data->getValue($config);
        if ($state['hash'] === null || !is_array($value) || $state['hash'] !== Xml::scalarTreeSignature($value)) {
            unset($this->configs[$config]);
            $this->limitations['layout-registry-data-replaced'] = true;
            return null;
        }
        return $state;
    }

    private function membership($config, array $params, $exists, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== Config::class || get_class($config) !== Config::class) return;
        $this->healthy = true;
        $state = $this->state($config);
        $context = ($this->context)();
        if (!$state || !$context) { $this->limitations['layout-registry-context'] = true; return; }
        $this->unconfirmed($state, $context);
        if ($exists && isset($state['rows'][$params[0]])) $this->entry($state['rows'][$params[0]], $context, false);
    }

    private function options($config, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== Config::class || get_class($config) !== Config::class) return;
        $this->healthy = true;
        $state = $this->state($config);
        $context = ($this->context)();
        if (!$state || !$context) { $this->limitations['layout-registry-context'] = true; return; }
        $this->unconfirmed($state, $context);
        foreach ($state['rows'] as $row) $this->entry($row, $context, true);
    }

    private function entry(array $row, array $context, bool $label): void
    {
        $this->record($row['node'], 'layout-registry-entry-consumed', $context);
        $this->record($row['id'], 'layout-registry-id-consumed', $context);
        $this->record($row['parent'], 'layout-registry-entry-configured', $context);
        foreach (array_keys($row['allIds']) as $id) {
            if ($id !== $row['id']) $this->record($id, 'layout-registry-overridden', $context);
        }
        if (!$label) return;
        foreach ($row['labels'] as $id) $this->record($id, 'layout-registry-label-consumed', $context);
        foreach ($row['labelParents'] as $id) $this->record($id, 'layout-registry-entry-configured', $context);
        foreach (array_keys($row['allLabels']) as $id) {
            if (in_array($id, $row['labels'], true)) continue;
            $effect = $row['labelUnconfirmed'] ? 'layout-registry-label-unconfirmed'
                : (isset($row['ignored'][$id]) ? 'layout-registry-label-ignored' : 'layout-registry-overridden');
            $this->record($id, $effect, $context);
        }
    }

    private function unconfirmed(array $state, array $context): void
    {
        foreach ($state['unconfirmed'] as $id) $this->record($id, 'layout-registry-cache-unconfirmed', $context);
    }

    private function snapshotReturned($config, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== Config::class || get_class($config) !== Config::class) return;
        $this->healthy = true;
        $state = $this->state($config);
        $context = ($this->context)();
        if (!$state || !$context) return;
        foreach ($state['rows'] as $row) {
            foreach (array_unique(array_filter([$row['node'], $row['id'], ...$row['labels']])) as $id) {
                $this->record($id, 'layout-registry-snapshot-returned', $context);
            }
        }
        $this->unconfirmed($state, $context);
    }

    private function replaced($property, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== \ReflectionProperty::class || !isset($params[0])) return;
        static $getName;
        $getName ??= new \ReflectionMethod(\ReflectionProperty::class, 'getName');
        $name = $getName->invoke($property);
        if ($params[0] instanceof \Magento\Framework\DataObject && $name === '_data') {
            unset($this->typeObjects[$params[0]]);
        }
        if ($params[0] instanceof ConfigData && $name === '_data') {
            unset($this->typeStorage[$params[0]]);
            $this->typeStorageLimits[$params[0]] = 'layout-registry-data-replaced';
        }
        if ($params[0] instanceof PageTypes && $name === '_pageTypes') {
            $this->limitations['layout-registry-data-replaced'] = true;
        }
        if ($params[0] instanceof Builder && $name === 'configFiles') unset($this->builderReads[$params[0]]);
        if ($params[0] instanceof Config && in_array($name, ['_data', '_domConfig'], true)) {
            unset($this->configs[$params[0]]);
            $this->limitations['layout-registry-data-replaced'] = true;
        }
    }

    private function beginTypes($reader, array $params, string $class): void
    {
        if ($class !== Filesystem::class) return;
        $frame = null;
        if ($reader instanceof TypeReader) {
            static $converter;
            $converter ??= new \ReflectionProperty(Filesystem::class, '_converter');
            if (get_class($reader) === TypeReader::class && get_class($converter->getValue($reader)) === TypeConverter::class
                && get_class($params[0]) === FileIterator::class) {
                $frame = ['family' => 'page-types', 'object' => $reader, 'unconfirmed' => [], 'rows' => []];
            } else $this->limitations['layout-registry-custom-provider'] = true;
        }
        $this->reading[] = $frame;
    }

    private function typeFile($iterator, array $params, $bytes, ?\Throwable $error, string $class): void
    {
        $scope = array_key_last($this->reading);
        $frame = $scope === null ? null : $this->reading[$scope];
        if ($error || $class !== FileIterator::class || !$frame || $frame['family'] !== 'page-types' || $this->disabled) return;
        $caller = self::caller();
        if (($caller['class'] ?? null) !== Filesystem::class || ($caller['function'] ?? null) !== '_readFiles') return;
        $path = $iterator->key();
        $relative = str_starts_with($path, BP . '/') ? substr($path, strlen(BP) + 1) : '';
        $source = $this->sources[$relative] ?? null;
        $hash = hash('sha256', $bytes);
        if ($source && ($source['hash'] !== $hash || realpath($path) !== $path)) {
            $this->errors['Page type source changed or became a symlink after preparation'] = true;
        }
        $this->reading[$scope]['count'] = ($frame['count'] ?? 0) + 1;
        $this->reading[$scope]['bytes'] = ($frame['bytes'] ?? 0) + strlen($bytes);
        if ($this->reading[$scope]['count'] > 512 || $this->reading[$scope]['bytes'] > 2097152) { $this->limit(); return; }
        if (isset($frame['pending'])) $this->errors['Missing native page type input merge evidence'] = true;
        $this->reading[$scope]['pending'] = ['hash' => $hash, 'targets' => $source['targets'] ?? [], 'unconfirmed' => []];
    }

    private function typesConverted($converter, array $params, $data, ?\Throwable $error, string $class): void
    {
        $scope = array_key_last($this->reading);
        $frame = $scope === null ? null : $this->reading[$scope];
        if ($error || $class !== TypeConverter::class || !$frame || $frame['family'] !== 'page-types' || $this->disabled) return;
        $rows = [];
        foreach ($params[0]->getElementsByTagName('type') as $node) {
            $metadata = $this->nodes[$node] ?? [];
            $rows[$node->getAttribute('id')] = ['node' => $metadata['node'] ?? null,
                'id' => $metadata['attributes']['id'] ?? null, 'label' => $metadata['attributes']['label'] ?? null,
                'parents' => array_values(array_filter($metadata['parents'] ?? [])),
                'fields' => array_keys($frame['fields'][$node->getAttribute('id')] ?? [])];
        }
        $this->reading[$scope]['rows'] = $rows;
        $this->reading[$scope]['hash'] = Xml::scalarTreeSignature($data);
    }

    private function completeTypes($reader, array $params, $data, ?\Throwable $error, string $class): void
    {
        if ($class !== Filesystem::class) return;
        $frame = array_pop($this->reading);
        if ($error || !$frame || !empty($frame['unsupported']) || $this->disabled || !isset($frame['hash'])) return;
        if (isset($frame['pending'])) { $this->errors['Missing native page type input merge evidence'] = true; return; }
        $state = ['rows' => $frame['rows'], 'hash' => $frame['hash']];
        $index = array_key_last($this->dataConstruction);
        if ($index !== null && $this->dataConstruction[$index]['reader'] === $reader) $this->dataConstruction[$index]['state'] = $state;
    }

    private function beginData($storage, array $params, string $class, string $method): void
    {
        if ($class !== ConfigData::class) return;
        $reader = $params[0] ?? null;
        if ($method === 'reset') {
            static $property;
            $property ??= new \ReflectionProperty(ConfigData::class, 'reader');
            $reader = $property->getValue($storage);
        }
        unset($this->typeStorage[$storage]);
        $this->dataConstruction[] = ['object' => $storage, 'reader' => $reader, 'state' => null];
    }

    private function completeData($storage, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== ConfigData::class) return;
        $frame = array_pop($this->dataConstruction);
        if (!$error && get_class($storage) === ConfigData::class && $frame['state']) {
            $this->typeStorage[$storage] = $frame['state'];
            unset($this->typeStorageLimits[$storage]);
        } elseif (!$error) {
            $this->typeStorageLimits[$storage] = get_class($storage) === ConfigData::class && get_class($frame['reader']) === TypeReader::class
                ? 'layout-page-types-cache' : 'layout-registry-custom-provider';
        }
    }

    private function typeDataChanged($storage, array $params, string $class): void
    {
        if ($class === ConfigData::class) {
            unset($this->typeStorage[$storage]);
            $this->typeStorageLimits[$storage] = 'layout-registry-data-replaced';
        }
    }

    private function beginTypeInitialization($config, array $params, string $class): void
    {
        if ($class === PageTypes::class) $this->typeInitialization[] = ['object' => $config, 'state' => null];
    }

    private function typesData($storage, array $params, $data, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->typeInitialization);
        $caller = self::caller();
        if ($error || $class !== ConfigData::class || $index === null || ($params[0] ?? null) !== null
            || ($caller['class'] ?? null) !== PageTypes::class || ($caller['function'] ?? null) !== '_initPageTypes') return;
        $state = $this->typeStorage[$storage] ?? null;
        if (!$state || !is_array($data) || Xml::scalarTreeSignature($data) !== $state['hash']) {
            $this->limitations[$this->typeStorageLimits[$storage] ?? 'layout-registry-data-replaced'] = true;
            return;
        }
        $this->typeInitialization[$index]['state'] = $state;
    }

    private function completeTypeInitialization($config, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== PageTypes::class) return;
        $frame = array_pop($this->typeInitialization);
        if ($error || get_class($config) !== PageTypes::class) return;
        $this->healthy = true;
        if (!$frame['state']) return;
        $context = ($this->context)();
        if (!$context) { $this->limitations['layout-registry-context'] = true; return; }
        $this->healthy = true;
        static $property, $dataProperty;
        $property ??= new \ReflectionProperty(PageTypes::class, '_pageTypes');
        $dataProperty ??= new \ReflectionProperty(\Magento\Framework\DataObject::class, '_data');
        foreach ($property->getValue($config) as $id => $object) {
            $row = $frame['state']['rows'][$id] ?? null;
            if (!$row || get_class($object) !== \Magento\Framework\DataObject::class) continue;
            $data = $dataProperty->getRawValue($object);
            $fields = [];
            foreach (['id', 'label'] as $key) {
                if (isset($row[$key]) && array_key_exists($key, $data)) {
                    $fields[$key] = ['id' => $row[$key], 'hash' => Xml::scalarTreeSignature([$data[$key]])];
                }
            }
            if ($fields) $this->typeObjects[$object] = $fields;
            $applied = array_unique(array_filter([$row['node'], $row['id'], $row['label'], ...$row['parents']]));
            foreach ($applied as $origin) $this->record($origin, 'layout-page-type-applied', $context);
            foreach (array_diff($row['fields'], $applied) as $origin) $this->record($origin, 'layout-registry-overridden', $context);
        }
    }

    private function typeObjectChanged($object, array $params, $result, ?\Throwable $error, string $class, string $method): void
    {
        if ($error || $class !== \Magento\Framework\DataObject::class || !isset($this->typeObjects[$object])) return;
        $key = $params[0] ?? null;
        if (($method === 'setData' && is_array($key)) || ($method === 'unsetData' && $key === null)) {
            unset($this->typeObjects[$object]);
        } elseif ($key === 'id' || $key === 'label') {
            $fields = $this->typeObjects[$object];
            unset($fields[$key]);
            $this->typeObjects[$object] = $fields;
        }
    }

    private function typeValueRead($object, array $params, $value, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== \Magento\Framework\DataObject::class || !isset($this->typeObjects[$object])) return;
        $key = $params[0] ?? '';
        if (($key !== 'id' && $key !== 'label') || ($params[1] ?? null) !== null) return;
        $fields = $this->typeObjects[$object];
        $field = $fields[$key] ?? null;
        if (!$field) return;
        if ($field['hash'] === null || Xml::scalarTreeSignature([$value]) !== $field['hash']) {
            unset($fields[$key]);
            $this->typeObjects[$object] = $fields;
            $this->limitations['layout-registry-data-replaced'] = true;
            return;
        }
        $context = ($this->context)();
        if ($context) $this->record($field['id'], 'layout-page-type-read', $context);
    }

    private function record(?string $id, string $effect, array $context): void
    {
        if ($id !== null) ($this->event)($id, $effect, $context);
    }
}
