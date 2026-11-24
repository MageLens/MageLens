<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\Url;
use Magento\Framework\View\Asset\Collection;
use Magento\Framework\View\Asset\File;
use Magento\Framework\View\Asset\Remote;
use Magento\Framework\View\Asset\GroupedCollection;
use Magento\Framework\View\Asset\PropertyGroup;
use Magento\Framework\View\Page\Config;
use Magento\Framework\View\Page\Config\Generator\Head as Generator;
use Magento\Framework\View\Page\Config\Reader\Head;
use Magento\Framework\View\Page\Config\Renderer;
use Magento\Framework\View\Page\Config\Structure;

final class LayoutAssetsCoverage
{
    private \WeakMap $scheduled;
    private \WeakMap $assets;
    private array $reading = [];
    private array $removing = [];
    private array $generating = [];
    private array $routing = [];
    private array $adding = [];
    private array $rendering = [];

    public function __construct(private readonly \Closure $origin)
    {
        $this->scheduled = new \WeakMap();
        $this->assets = new \WeakMap();
    }

    public function hooks(): array
    {
        return [
            [Head::class, 'processNode', $this->beginRead(...), $this->endRead(...)],
            [Structure::class, 'addAssets', null, $this->scheduleAsset(...)],
            [Structure::class, 'processRemoveAssets', $this->beginRemoval(...), $this->endRemoval(...)],
            [Generator::class, 'processAssets', $this->beginGeneration(...), $this->endGeneration(...)],
            [Structure::class, 'getAssets', null, $this->generationAssets(...)],
            [Generator::class, 'getAssetProperties', null, $this->assetProperties(...)],
            [Url::class, 'getUrl', $this->beginControllerUrl(...), $this->endControllerUrl(...)],
            [Config::class, 'addPageAsset', $this->beginAdd(...), $this->endAdd(...)],
            [Config::class, 'addRemotePageAsset', $this->beginAdd(...), $this->endAdd(...)],
            [GroupedCollection::class, 'add', null, $this->addedAsset(...)],
            [Collection::class, 'add', $this->replaceAsset(...), null],
            [Collection::class, 'insert', $this->replaceAsset(...), null],
            [Collection::class, 'remove', $this->removeAsset(...), null],
            [Renderer::class, 'renderAssetGroup', $this->beginRender(...), $this->endRender(...)],
            [Renderer::class, 'renderAssetHtml', null, $this->assetOutput(...)],
            [Renderer::class, 'getGroupAttributes', null, $this->groupAttributes(...)],
            [Renderer::class, 'addDefaultAttributes', $this->beginDefaults(...), $this->endDefaults(...)],
            [Renderer::class, 'canTypeBeFont', null, $this->fontDefaults(...)],
            [Renderer::class, 'getAssetTemplate', null, $this->assetTemplate(...)],
            [Renderer::class, 'processIeCondition', null, $this->conditionalOutput(...)],
            [File::class, 'getUrl', null, $this->referenceUrl(...)],
            [Remote::class, 'getUrl', null, $this->referenceUrl(...)],
        ];
    }

    public function finish(): void
    {
        if ($this->routing) throw new \RuntimeException('Unbalanced native controller asset URL evidence');
        if ($this->reading || $this->removing || $this->generating || $this->adding || $this->rendering) {
            throw new \RuntimeException('Unbalanced native asset observations');
        }
    }

    public function snapshot(Structure $structure): array
    {
        return $this->scheduled[$structure] ?? [];
    }

    public function restore(Structure $structure, array $state): void
    {
        $this->scheduled[$structure] = $state;
    }

    public function reset(Structure $structure): void
    {
        unset($this->scheduled[$structure]);
    }

    private static function signature(array $data): ?string
    {
        return Xml::scalarTreeSignature($data);
    }

    private static function storage(object $object, string $class, string $name): ?array
    {
        static $fields = [];
        $property = $fields[$class][$name] ??= new \ReflectionProperty($class, $name);
        $actual = LayoutXmlOwnership::unhookedProperty($object, $name);
        if ($actual?->getDeclaringClass()->getName() !== $class || $actual->isStatic()) return null;
        $value = $property->getRawValue($object);
        return is_array($value) ? $value : null;
    }

    private static function caller(object $object, string $method): array
    {
        $trace = LayoutRuntimeHooks::trace(DEBUG_BACKTRACE_IGNORE_ARGS, 5);
        $caller = $trace[3] ?? [];
        $wrapper = get_class($object);
        if (str_ends_with($wrapper, '\\Interceptor') && ($caller['class'] ?? null) === $wrapper
            && ($caller['function'] ?? null) === $method) {
            $caller = $trace[4] ?? [];
        }
        return $caller;
    }

    private function beginRead($reader, array $params, string $class): void
    {
        if ($class !== Head::class) return;
        [$ids, $context] = ($this->origin)($params[0]);
        $this->reading[] = ['structure' => $params[1], 'ids' => $ids, 'context' => $context];
    }

    private function endRead($reader, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class === Head::class) array_pop($this->reading);
    }

    private function scheduleAsset($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== Structure::class) return;
        [$name, $data] = $params;
        $state = $this->snapshot($structure);
        $previous = $state[$name] ?? null;
        unset($state[$name]);
        $read = $this->reading[array_key_last($this->reading)] ?? null;
        $caller = self::caller($structure, 'addAssets');
        $native = $read && $read['structure'] === $structure && isset($read['ids']['asset-reference'])
            && ($caller['class'] ?? null) === Head::class && ($caller['function'] ?? null) === 'processNode';
        if ($previous) self::record($previous, $native ? 'layout-asset-overridden' : 'layout-asset-replaced');
        if ($native) $state[$name] = ['ids' => $read['ids'], 'context' => $read['context'], 'signature' => self::signature($data)];
        $this->restore($structure, $state);
    }

    private function beginRemoval($structure, array $params, string $class): void
    {
        if ($class !== Structure::class) return;
        $storage = self::storage($structure, Structure::class, 'assets');
        $this->removing[] = $storage === null ? null : array_intersect_key($this->snapshot($structure), $storage);
    }

    private function endRemoval($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Structure::class) return;
        $before = array_pop($this->removing);
        if ($error) return;
        $state = $this->snapshot($structure);
        $storage = self::storage($structure, Structure::class, 'assets');
        if ($before === null || $storage === null) {
            foreach ($state as $origin) self::record($origin, 'layout-asset-storage-unconfirmed');
            $this->reset($structure);
            return;
        }
        foreach (array_diff_key($before, $storage) as $name => $origin) {
            self::record($origin, 'layout-asset-removed-before-output');
            unset($state[$name]);
        }
        $this->restore($structure, $state);
    }

    private function beginGeneration($generator, array $params, string $class): void
    {
        if ($class !== Generator::class) return;
        $this->generating[] = ['structure' => $params[0], 'state' => [], 'properties' => null, 'route' => null, 'observed' => false];
    }

    private function generationAssets($structure, array $params, $assets, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->generating);
        if ($error || $class !== Structure::class || $index === null || $this->generating[$index]['structure'] !== $structure
            || !is_array($assets)) return;
        $caller = self::caller($structure, 'getAssets');
        if (($caller['class'] ?? null) !== Generator::class || ($caller['function'] ?? null) !== 'processAssets'
            || (new \ReflectionMethod($structure, 'getAssets'))->getDeclaringClass()->getName() !== Structure::class) return;
        $state = $this->snapshot($structure);
        $valid = [];
        foreach ($assets as $name => $data) {
            if (!isset($state[$name]) || $state[$name]['signature'] === null
                || $state[$name]['signature'] !== self::signature($data)) continue;
            $valid[$name] = $state[$name];
            if (($data['src_type'] ?? null) === Generator::SRC_TYPE_CONTROLLER) {
                unset($data['src']);
                $valid[$name]['controller'] = self::signature($data);
            }
        }
        $this->generating[$index]['state'] = $valid;
        $this->generating[$index]['observed'] = true;
    }

    private function endGeneration($generator, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Generator::class) return;
        $frame = array_pop($this->generating);
        if (!$error && !$frame['observed']) {
            foreach ($this->snapshot($frame['structure']) as $origin) self::record($origin, 'layout-asset-storage-unconfirmed');
        }
    }

    private function beginControllerUrl($url, array $params, string $class): void
    {
        $index = array_key_last($this->generating);
        if ($class !== Url::class || $index === null) return;
        if (count($this->routing) >= 256) throw new \RuntimeException('Native controller asset URL nesting exceeded 256 calls');
        $name = $params[0] ?? null;
        $caller = self::caller($url, 'getUrl');
        $native = is_string($name) && isset($this->generating[$index]['state'][$name]['controller'])
            && ($caller['class'] ?? null) === Generator::class && ($caller['function'] ?? null) === 'processAssets';
        $this->routing[] = $native ? ['url' => $url, 'index' => $index, 'name' => $name] : null;
    }

    private function endControllerUrl($url, array $params, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->generating);
        if ($class !== Url::class || $index === null) return;
        if (!$this->routing) throw new \RuntimeException('Missing native controller asset URL entry evidence');
        $call = array_pop($this->routing);
        if (!$call || $error || !is_string($result)) return;
        if ($call['url'] !== $url || $call['index'] !== $index) throw new \RuntimeException('Mismatched native controller asset URL evidence');
        $this->generating[$index]['route'] = ['name' => $call['name'], 'signature' => hash('sha256', $result)];
    }

    private function assetProperties($generator, array $params, $properties, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->generating);
        if ($error || $class !== Generator::class || $index === null) return;
        $frame = &$this->generating[$index];
        $data = $params[0];
        $src = $data['src'] ?? '';
        $name = $src;
        $signature = self::signature($data);
        $route = $frame['route'];
        $frame['route'] = null;
        $controller = ($data['src_type'] ?? null) === Generator::SRC_TYPE_CONTROLLER;
        if ($controller) {
            if (!$route || !is_string($src) || $route['signature'] !== hash('sha256', $src)) {
                $frame['properties'] = null;
                return;
            }
            $name = $route['name'];
            unset($data['src']);
            $signature = self::signature($data);
        }
        $origin = $frame['state'][$name] ?? null;
        $expected = $origin[$controller ? 'controller' : 'signature'] ?? null;
        $frame['properties'] = $expected !== null && $expected === $signature
            ? ['name' => $name, 'origin' => $origin, 'signature' => self::signature($properties),
                'attributes' => self::signature($properties['attributes'] ?? []),
                'controller' => $controller ? $route['signature'] : null,
                'order' => isset($properties['order']) ? (string) $properties['order'] : null] : null;
    }

    private function beginAdd($config, array $params, string $class, string $function): void
    {
        if ($class !== Config::class) return;
        $index = array_key_last($this->generating);
        $candidate = $this->generating[$index]['properties'] ?? null;
        $caller = self::caller($config, $function);
        $remote = $function === 'addRemotePageAsset';
        $name = (string) ($remote ? ($params[3] ?? $params[0]) : ($params[2] ?? $params[0]));
        $properties = $params[$remote ? 2 : 1] ?? [];
        $native = ($caller['class'] ?? null) === Generator::class && ($caller['function'] ?? null) === 'processAssets';
        $valid = $native && $candidate && $candidate['name'] === $name && $candidate['signature'] === self::signature($properties)
            && ($candidate['controller'] === null || ($remote && is_string($params[0]) && $candidate['controller'] === hash('sha256', $params[0])));
        if ($valid && $candidate['controller'] !== null) {
            self::record($candidate['origin'], 'layout-asset-controller-url-generated', ['asset-src', 'asset-src-type']);
        } elseif (!$valid && $remote && $native && isset($this->generating[$index]['state'][$name]['controller'])) {
            self::record($this->generating[$index]['state'][$name], 'layout-asset-controller-origin-unconfirmed');
        }
        if ($valid && $remote && !$name) $candidate['name'] = (string) $params[0];
        $this->adding[] = $valid ? $candidate : null;
        if ($index !== null) $this->generating[$index]['properties'] = null;
    }

    private function endAdd($config, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class === Config::class) array_pop($this->adding);
    }

    private function replaceAsset($collection, array $params, string $class): void
    {
        if ($class === Collection::class && isset($params[1]) && is_object($params[1])) unset($this->assets[$params[1]]);
    }

    private function removeAsset($collection, array $params, string $class): void
    {
        if ($class !== Collection::class) return;
        $asset = self::storage($collection, Collection::class, 'assets')[$params[0]] ?? null;
        if ($asset) unset($this->assets[$asset]);
    }

    private function addedAsset($collection, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== GroupedCollection::class) return;
        $candidate = $this->adding[array_key_last($this->adding)] ?? null;
        $caller = self::caller($collection, 'add');
        if (!$candidate || $candidate['name'] !== (string) $params[0] || ($caller['class'] ?? null) !== Config::class
            || !in_array($caller['function'] ?? null, ['addPageAsset', 'addRemotePageAsset'], true)) return;
        $matches = [];
        foreach (self::storage($collection, GroupedCollection::class, 'groups') ?? [] as $group) {
            if ($group instanceof PropertyGroup && (self::storage($group, Collection::class, 'assets')[$params[0]] ?? null) === $params[1]) {
                $matches[] = $group;
            }
        }
        $group = count($matches) === 1 ? $matches[0] : null;
        $properties = $group ? self::storage($group, PropertyGroup::class, 'properties') : null;
        if ($properties === null) {
            self::record($candidate['origin'], 'layout-asset-storage-unconfirmed');
            return;
        }
        $this->assets[$params[1]] = ['group' => $group, 'origin' => $candidate['origin'],
            'properties' => self::signature($properties), 'attributes' => $candidate['attributes']];
        if ($candidate['order'] !== null && (string) ($properties['order'] ?? '') === $candidate['order']) {
            self::record($candidate['origin'], 'layout-asset-group-applied', ['asset-order']);
        }
    }

    private function beginRender($renderer, array $params, string $class): void
    {
        if ($class !== Renderer::class) return;
        $group = $params[0];
        $origins = [];
        foreach (self::storage($group, Collection::class, 'assets') ?? [] as $asset) {
            if (!is_object($asset)) continue;
            $binding = $this->assets[$asset] ?? null;
            if ($binding && $binding['group'] === $group) $origins[spl_object_id($asset)] = $binding['origin'];
        }
        $this->rendering[] = ['renderer' => $renderer, 'group' => $group, 'allOrigins' => $origins,
            'origins' => [], 'pending' => [], 'attributes' => false, 'defaults' => false, 'font' => false,
            'template' => null, 'conditional' => false];
    }

    private function groupAttributes($renderer, array $params, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->rendering);
        if ($error || $class !== Renderer::class || $index === null || $this->rendering[$index]['group'] !== $params[0]) return;
        $caller = self::caller($renderer, 'getGroupAttributes');
        if (($caller['class'] ?? null) === Renderer::class && ($caller['function'] ?? null) === 'renderAssetHtml'
            && (new \ReflectionMethod($renderer, 'getGroupAttributes'))->getDeclaringClass()->getName() === Renderer::class) {
            $this->rendering[$index]['attributes'] = true;
        }
    }

    private function beginDefaults($renderer, array $params, string $class): void
    {
        $index = array_key_last($this->rendering);
        if ($class !== Renderer::class || $index === null) return;
        $this->rendering[$index]['defaults'] = false;
        $this->rendering[$index]['font'] = false;
        $this->rendering[$index]['template'] = null;
    }

    private function fontDefaults($renderer, array $params, $font, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->rendering);
        if ($error || $class !== Renderer::class || $index === null) return;
        $caller = self::caller($renderer, 'canTypeBeFont');
        if (($caller['class'] ?? null) === Renderer::class && ($caller['function'] ?? null) === 'addDefaultAttributes') {
            $this->rendering[$index]['font'] = $font === true;
        }
    }

    private function endDefaults($renderer, array $params, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->rendering);
        if ($error || $class !== Renderer::class || $index === null) return;
        $caller = self::caller($renderer, 'addDefaultAttributes');
        if (($caller['class'] ?? null) === Renderer::class && ($caller['function'] ?? null) === 'renderAssetHtml'
            && (new \ReflectionMethod($renderer, 'addDefaultAttributes'))->getDeclaringClass()->getName() === Renderer::class) {
            $this->rendering[$index]['defaults'] = true;
        }
    }

    private function assetTemplate($renderer, array $params, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->rendering);
        if ($error || $class !== Renderer::class || $index === null) return;
        $caller = self::caller($renderer, 'getAssetTemplate');
        if (($caller['class'] ?? null) === Renderer::class && ($caller['function'] ?? null) === 'renderAssetHtml'
            && (new \ReflectionMethod($renderer, 'getAssetTemplate'))->getDeclaringClass()->getName() === Renderer::class) {
            $this->rendering[$index]['template'] = is_string($result) ? $result : null;
        }
    }

    private function conditionalOutput($renderer, array $params, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->rendering);
        if (!$error && $class === Renderer::class && $index !== null && $this->rendering[$index]['group'] === $params[1]
            && is_string($result) && ($condition = self::storage($params[1], PropertyGroup::class, 'properties')['ie_condition'] ?? null)
            && str_starts_with($result, '<!--[if ' . $condition . ']>')
            && (new \ReflectionMethod($renderer, 'processIeCondition'))->getDeclaringClass()->getName() === Renderer::class) {
            $this->rendering[$index]['conditional'] = true;
        }
    }

    private function referenceUrl($asset, array $params, $url, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->rendering);
        if ($error || !in_array($class, [File::class, Remote::class], true) || $index === null || !isset($this->assets[$asset])) return;
        $caller = self::caller($asset, 'getUrl');
        if (($caller['class'] ?? null) !== Renderer::class || ($caller['function'] ?? null) !== 'renderAssetHtml') return;
        $frame = &$this->rendering[$index];
        $binding = $this->assets[$asset];
        if ($binding['group'] !== $frame['group']) return;
        $assetId = spl_object_id($asset);
        $frame['allOrigins'][$assetId] = $binding['origin'];
        if ($frame['template'] === null) return;
        $template = $frame['template'];
        $frame['template'] = null;
        $properties = self::storage($frame['group'], PropertyGroup::class, 'properties');
        if ($properties === null || $binding['properties'] === null || $binding['properties'] !== self::signature($properties)
            || !is_string($url) || substr_count($template, '%') !== 1 || !str_contains($template, '%s')) return;
        $attributes = $frame['attributes'] && $frame['defaults']
            && (new \ReflectionMethod($frame['group'], 'getProperty'))->getDeclaringClass()->getName() === PropertyGroup::class
            && $binding['attributes'] === self::signature($properties['attributes'] ?? []);
        $frame['pending'][] = ['asset' => $assetId, 'origin' => $binding['origin'], 'attributes' => $attributes, 'font' => $frame['font'],
            'fragment' => str_replace('%s', $url, $template)];
    }

    private function assetOutput($renderer, array $params, $html, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->rendering);
        if ($class !== Renderer::class || $index === null) return;
        $frame = &$this->rendering[$index];
        if ($frame['renderer'] !== $renderer || $frame['group'] !== $params[0]) return;
        $caller = self::caller($renderer, 'renderAssetHtml');
        if (($caller['class'] ?? null) !== Renderer::class || ($caller['function'] ?? null) !== 'renderAssetGroup') return;
        $offset = 0;
        foreach ($frame['pending'] as $entry) {
            $position = !$error && is_string($html) ? strpos($html, $entry['fragment'], $offset) : false;
            if ($position === false) continue;
            $offset = $position + strlen($entry['fragment']);
            $frame['origins'][] = $entry;
        }
        $frame['pending'] = [];
    }

    private function endRender($renderer, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Renderer::class) return;
        $frame = array_pop($this->rendering);
        if ($error) return;
        if ((new \ReflectionMethod($renderer, 'renderAssetHtml'))->getDeclaringClass()->getName() !== Renderer::class
            || (new \ReflectionMethod($renderer, 'processIeCondition'))->getDeclaringClass()->getName() !== Renderer::class) {
            $frame['origins'] = [];
        }
        foreach ($frame['origins'] as $entry) {
            unset($frame['allOrigins'][$entry['asset']]);
            $origin = $entry['origin'];
            self::record($origin, 'layout-asset-reference-rendered', ['asset-reference', 'asset-src', 'asset-src-type']);
            if ($frame['conditional']) self::record($origin, 'layout-asset-condition-rendered', ['asset-condition']);
            $attributes = array_filter(array_keys($origin['ids']), static fn($kind) => str_starts_with($kind, 'asset-attribute-'));
            $effect = !$entry['attributes'] ? 'layout-asset-emission-unconfirmed'
                : ($entry['font'] ? 'layout-asset-attributes-discarded' : 'layout-asset-attribute-emitted');
            self::record($origin, $effect, $attributes);
        }
        foreach ($frame['allOrigins'] as $origin) self::record($origin, 'layout-asset-emission-unconfirmed');
    }

    private static function record(array $origin, string $effect, ?array $kinds = null): void
    {
        foreach ($origin['ids'] as $kind => $id) {
            if (str_starts_with($kind, 'asset-') && ($kinds === null || in_array($kind, $kinds, true))) {
                Recorder::layout($id, $effect, $origin['context']);
            }
        }
    }
}
