<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\View\Asset\Collection;
use Magento\Framework\View\Asset\File;
use Magento\Framework\View\Asset\Remote;
use Magento\Framework\View\Asset\GroupedCollection;
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
            [Generator::class, 'getAssetProperties', null, $this->assetProperties(...)],
            [Config::class, 'addPageAsset', $this->beginAdd(...), $this->endAdd(...)],
            [Config::class, 'addRemotePageAsset', $this->beginAdd(...), $this->endAdd(...)],
            [GroupedCollection::class, 'add', null, $this->addedAsset(...)],
            [Collection::class, 'add', $this->replaceAsset(...), null],
            [Collection::class, 'insert', $this->replaceAsset(...), null],
            [Collection::class, 'remove', $this->removeAsset(...), null],
            [Renderer::class, 'renderAssetGroup', $this->beginRender(...), $this->endRender(...)],
            [Renderer::class, 'getGroupAttributes', null, $this->groupAttributes(...)],
            [Renderer::class, 'addDefaultAttributes', $this->beginDefaults(...), $this->endDefaults(...)],
            [Renderer::class, 'canTypeBeFont', null, $this->fontDefaults(...)],
            [Renderer::class, 'getAssetTemplate', null, $this->assetTemplate(...)],
            [Renderer::class, 'processIeCondition', null, $this->conditionalOutput(...)],
            [File::class, 'getUrl', null, $this->referenceUrl(...)],
            [Remote::class, 'getUrl', null, $this->referenceUrl(...)],
        ];
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

    private static function caller(object $object, string $method): array
    {
        $trace = LayoutRuntimeHooks::trace(DEBUG_BACKTRACE_IGNORE_ARGS, 5);
        $caller = $trace[3] ?? [];
        $invocation = $trace[2] ?? [];
        $wrapper = get_class($object);
        if (str_ends_with($wrapper, '\\Interceptor') && ($caller['class'] ?? null) === $wrapper
            && ($caller['function'] ?? null) === $method) {
            $invocation = $caller;
            $caller = $trace[4] ?? [];
        }
        return [...$caller, 'invocationLine' => $invocation['line'] ?? null, 'invocationFile' => $invocation['file'] ?? null];
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
        if ($class === Structure::class) $this->removing[] = array_intersect_key($this->snapshot($structure), $structure->getAssets());
    }

    private function endRemoval($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Structure::class) return;
        $before = array_pop($this->removing);
        if ($error) return;
        $state = $this->snapshot($structure);
        foreach (array_diff_key($before, $structure->getAssets()) as $name => $origin) {
            self::record($origin, 'layout-asset-removed-before-output');
            unset($state[$name]);
        }
        $this->restore($structure, $state);
    }

    private function beginGeneration($generator, array $params, string $class): void
    {
        if ($class !== Generator::class) return;
        $state = $this->snapshot($params[0]);
        $valid = [];
        foreach ($params[0]->getAssets() as $name => $data) {
            if (isset($state[$name]) && $state[$name]['signature'] !== null
                && $state[$name]['signature'] === self::signature($data)) $valid[$name] = $state[$name];
        }
        $this->generating[] = ['state' => $valid, 'properties' => null];
    }

    private function endGeneration($generator, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class === Generator::class) array_pop($this->generating);
    }

    private function assetProperties($generator, array $params, $properties, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->generating);
        if ($error || $class !== Generator::class || $index === null) return;
        $data = $params[0];
        $origin = $this->generating[$index]['state'][$data['src'] ?? ''] ?? null;
        $this->generating[$index]['properties'] = $origin && $origin['signature'] === self::signature($data)
            ? ['name' => $data['src'], 'origin' => $origin, 'signature' => self::signature($properties),
                'attributes' => self::signature($properties['attributes'] ?? []),
                'order' => isset($properties['order']) ? (string) $properties['order'] : null] : null;
    }

    private function beginAdd($config, array $params, string $class, string $function): void
    {
        if ($class !== Config::class) return;
        $index = array_key_last($this->generating);
        $candidate = $index === null ? null : $this->generating[$index]['properties'];
        $caller = self::caller($config, $function);
        $remote = $function === 'addRemotePageAsset';
        $name = $remote ? ($params[3] ?? $params[0]) : ($params[2] ?? $params[0]);
        $properties = $params[$remote ? 2 : 1] ?? [];
        $valid = $candidate && $candidate['name'] === $name && $candidate['signature'] === self::signature($properties)
            && ($caller['class'] ?? null) === Generator::class && ($caller['function'] ?? null) === 'processAssets';
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
        $asset = $collection->getAll()[$params[0]] ?? null;
        if ($asset) unset($this->assets[$asset]);
    }

    private function addedAsset($collection, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== GroupedCollection::class) return;
        $candidate = $this->adding[array_key_last($this->adding)] ?? null;
        $caller = self::caller($collection, 'add');
        if (!$candidate || $candidate['name'] !== $params[0] || ($caller['class'] ?? null) !== Config::class
            || !in_array($caller['function'] ?? null, ['addPageAsset', 'addRemotePageAsset'], true)) return;
        foreach ($collection->getGroups() as $group) {
            if (($group->getAll()[$params[0]] ?? null) !== $params[1]) continue;
            $this->assets[$params[1]] = ['group' => $group, 'origin' => $candidate['origin'],
                'properties' => self::signature($group->getProperties()), 'attributes' => $candidate['attributes']];
            if ($candidate['order'] !== null && (string) $group->getProperty('order') === $candidate['order']) {
                self::record($candidate['origin'], 'layout-asset-group-applied', ['asset-order']);
            }
            return;
        }
    }

    private function beginRender($renderer, array $params, string $class): void
    {
        if ($class === Renderer::class) $this->rendering[] = ['group' => $params[0], 'origins' => [],
            'attributes' => false, 'defaults' => false, 'font' => false, 'template' => false, 'conditional' => false];
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
        $this->rendering[$index]['template'] = false;
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
            $this->rendering[$index]['template'] = true;
        }
    }

    private function conditionalOutput($renderer, array $params, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->rendering);
        if (!$error && $class === Renderer::class && $index !== null && $this->rendering[$index]['group'] === $params[1]
            && !empty($params[1]->getProperty('ie_condition'))
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
        static $emission, $nativeFile;
        if ($emission === null) {
            $method = new \ReflectionMethod(Renderer::class, 'renderAssetHtml');
            $nativeFile = $method->getFileName();
            $lines = file($nativeFile);
            $emission = [];
            for ($line = $method->getStartLine(); $line <= $method->getEndLine(); $line++) {
                if (str_contains($lines[$line - 1], 'sprintf($template, $asset->getUrl())')) $emission[] = $line;
            }
        }
        if (count($emission) !== 1 || $caller['invocationLine'] !== $emission[0] || $caller['invocationFile'] !== $nativeFile) return;
        $binding = $this->assets[$asset];
        $group = $this->rendering[$index]['group'];
        if ($binding['group'] === $group && $binding['properties'] === self::signature($group->getProperties())
            && $this->rendering[$index]['template']) {
            $attributes = $this->rendering[$index]['attributes'] && $this->rendering[$index]['defaults']
                && $binding['attributes'] === self::signature($group->getProperty('attributes') ?? []);
            $this->rendering[$index]['origins'][] = ['origin' => $binding['origin'],
                'attributes' => $attributes, 'font' => $this->rendering[$index]['font']];
        }
    }

    private function endRender($renderer, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Renderer::class) return;
        $frame = array_pop($this->rendering);
        if ($error) return;
        foreach ($frame['origins'] as $entry) {
            $origin = $entry['origin'];
            self::record($origin, 'layout-asset-reference-rendered', ['asset-reference', 'asset-src', 'asset-src-type']);
            if ($frame['conditional']) self::record($origin, 'layout-asset-condition-rendered', ['asset-condition']);
            if ($entry['attributes']) {
                $kinds = array_filter(array_keys($origin['ids']), static fn($kind) => str_starts_with($kind, 'asset-attribute-'));
                self::record($origin, $entry['font'] ? 'layout-asset-attributes-discarded' : 'layout-asset-attribute-emitted', $kinds);
            }
        }
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
