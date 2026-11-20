<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\View\Page\Config;
use Magento\Framework\View\Page\Config\Generator\Head as Generator;
use Magento\Framework\View\Page\Config\Generator\Body as BodyGenerator;
use Magento\Framework\View\Page\Config\Reader\Head;
use Magento\Framework\View\Page\Config\Reader\Body;
use Magento\Framework\View\Page\Config\Reader\Html;
use Magento\Framework\View\Page\Config\Renderer;
use Magento\Framework\View\Page\Config\Structure;

final class LayoutPageValuesCoverage
{
    private const METADATA_GETTERS = [
        'getCharset' => 'charset',
        'getContentType' => 'content_type',
        'getDescription' => 'description',
        'getKeywords' => 'keywords',
        'getMediaType' => 'media_type',
    ];

    private \WeakMap $scheduled;
    private \WeakMap $configs;
    private array $reading = [];
    private array $generating = [];
    private array $removing = [];
    private array $rendering = [];
    private array $metadataContents = [];
    private array $metadataReads = [];
    private array $classWrites = [];
    private array $classGeneration = [];
    private array $classAssignments = [];

    public function __construct(private readonly \Closure $origin)
    {
        $this->scheduled = new \WeakMap();
        $this->configs = new \WeakMap();
    }

    public function hooks(): array
    {
        return [
            [Structure::class, 'setBodyClass', $this->beginClassWrite(...), $this->endClassWrite(...)],
            [Structure::class, 'getBodyClasses', null, $this->readBodyClasses(...)],
            [BodyGenerator::class, 'processBodyClasses', $this->beginBodyClasses(...), $this->endBodyClasses(...)],
            [Config::class, 'addBodyClass', $this->beginClassAssignment(...), $this->endClassAssignment(...)],
            [Head::class, 'processNode', $this->beginRead(...), $this->endRead(...)],
            [Body::class, 'setBodyAttributeToStructure', $this->beginRead(...), $this->endRead(...)],
            [Html::class, 'interpret', $this->beginRead(...), $this->endRead(...)],
            [Structure::class, 'setMetadata', null, $this->scheduleMetadata(...)],
            [Structure::class, 'setElementAttribute', null, $this->scheduleAttribute(...)],
            [Structure::class, 'processRemoveElementAttributes', $this->beginRemoval(...), $this->endRemoval(...)],
            [Generator::class, 'processMetadata', $this->beginGeneration(...), $this->endGeneration(...)],
            [Generator::class, 'processElementAttributes', $this->beginGeneration(...), $this->endGeneration(...)],
            [Config::class, 'setMetadata', null, $this->applyMetadata(...)],
            [Config::class, 'setElementAttribute', null, $this->applyAttribute(...)],
            [Config::class, 'getMetadata', null, $this->readMetadata(...)],
            [Config::class, 'getElementAttributes', null, $this->readAttributes(...)],
            ...array_map(fn(string $method) => [Config::class, $method, $this->beginMetadataValue(...), $this->endMetadataValue(...)],
                array_keys(self::METADATA_GETTERS)),
            [Renderer::class, 'renderElementAttributes', $this->beginRender(...), $this->endRender(...)],
            [Renderer::class, 'renderMetadata', $this->beginRender(...), $this->endRender(...)],
            [Renderer::class, 'getMetadataTemplate', null, $this->metadataTemplate(...)],
            [Renderer::class, 'processMetadataContent', $this->beginMetadataContent(...), $this->metadataContent(...)],
        ];
    }

    public function finish(): void
    {
        if ($this->removing) throw new \RuntimeException('Unbalanced native page attribute removal evidence');
        if ($this->metadataContents || $this->metadataReads) throw new \RuntimeException('Unbalanced native metadata content evidence');
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

    private static function caller(object $subject, string $method): array
    {
        $trace = LayoutRuntimeHooks::trace(DEBUG_BACKTRACE_IGNORE_ARGS, 5);
        $caller = $trace[3] ?? [];
        $wrapper = get_class($subject);
        if (str_ends_with($wrapper, '\\Interceptor') && ($caller['class'] ?? null) === $wrapper
            && ($caller['function'] ?? null) === $method) return $trace[4] ?? [];
        return $caller;
    }

    private function beginRead($reader, array $params, string $class): void
    {
        if (!in_array($class, [Head::class, Body::class, Html::class], true)) return;
        [$node, $structure] = $class === Head::class ? $params : [$params[1], $params[0]->getPageConfigStructure()];
        $nodes = $class === Html::class ? iterator_to_array($node->attribute, false) : [$node];
        $this->reading[] = ['structure' => $structure, 'nodes' => $nodes, 'index' => 0, 'reader' => $class];
    }

    private function endRead($reader, array $params, $result, ?\Throwable $error, string $class): void
    {
        if (in_array($class, [Head::class, Body::class, Html::class], true)) array_pop($this->reading);
    }

    private function scheduleMetadata($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== Structure::class) return;
        $caller = self::caller($structure, 'setMetadata');
        $origin = $this->readOrigin($structure, $caller, Head::class, 'setMetadata', 'metadata');
        $this->scheduleValue($structure, ['metadata', $params[0]], 'metadata', $origin);
    }

    private function scheduleAttribute($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== Structure::class) return;
        $index = array_key_last($this->reading);
        $reader = $this->reading[$index]['reader'] ?? null;
        $method = match ($reader) {
            Head::class => 'processNode',
            Body::class => 'setBodyAttributeToStructure',
            default => 'interpret',
        };
        $caller = self::caller($structure, 'setElementAttribute');
        $origin = $this->readOrigin($structure, $caller, $reader, $method, 'page-attribute');
        [$element, $name, $value] = $params;
        if (!empty($value)) {
            $this->scheduleValue($structure, ['attributes', $element, $name], 'page-attribute', $origin);
            return;
        }
        if (!$origin) return;
        $queue = self::removalQueue($structure)[$element] ?? [];
        $index = array_key_last($queue);
        if ($index === null || $queue[$index] !== $name) return;
        $state = $this->snapshot($structure);
        $state['attributeRemovals'][$element][$index] = ['name' => $name, 'origin' => $origin];
        $this->restore($structure, $state);
    }

    private function readOrigin($structure, array $caller, ?string $reader, string $method, string $kind): ?array
    {
        $index = array_key_last($this->reading);
        $frame = $this->reading[$index] ?? null;
        if (!$frame || $frame['structure'] !== $structure || ($caller['class'] ?? null) !== $reader
            || ($caller['function'] ?? null) !== $method) return null;
        $node = $frame['nodes'][$frame['index']] ?? null;
        $this->reading[$index]['index']++;
        if (!$node) return null;
        [$ids, $context] = ($this->origin)($node);
        $ids = array_intersect_key($ids, array_flip([$kind, $kind . '-name', $kind . '-value', $kind . '-content']));
        return $ids ? ['ids' => $ids, 'context' => $context] : null;
    }

    private function scheduleValue($structure, array $keys, string $kind, ?array $origin): void
    {
        $state = $this->snapshot($structure);
        $target = &$state;
        foreach ($keys as $key) $target = &$target[$key];
        if ($target && $target !== $origin) $state['overridden'][$kind][] = $target;
        $target = $origin;
        $this->restore($structure, $state);
    }

    private static function removalQueue(Structure $structure): array
    {
        static $queue;
        $queue ??= new \ReflectionProperty(Structure::class, 'removeElementAttributes');
        return $queue->getRawValue($structure);
    }

    private static function elementAttributes(Structure $structure): array
    {
        static $attributes;
        $attributes ??= new \ReflectionProperty(Structure::class, 'elementAttributes');
        return $attributes->getRawValue($structure);
    }

    private function beginRemoval($structure, array $params, string $class): void
    {
        if ($class !== Structure::class) return;
        if (count($this->removing) >= 256) throw new \RuntimeException('Native page attribute removal nesting exceeded 256 calls');
        $caller = self::caller($structure, 'processRemoveElementAttributes');
        $native = ($caller['class'] ?? null) === Generator::class && ($caller['function'] ?? null) === 'process';
        $state = $this->snapshot($structure);
        $attributes = self::elementAttributes($structure);
        $targets = [];
        foreach (self::removalQueue($structure) as $element => $names) {
            $seen = [];
            foreach ($names as $index => $name) {
                $present = !isset($seen[$name]) && array_key_exists($name, $attributes[$element] ?? []);
                $seen[$name] = true;
                $entry = $state['attributeRemovals'][$element][$index] ?? null;
                $targets[$element][] = ['name' => $name, 'present' => $present,
                    'origin' => $native && ($entry['name'] ?? null) === $name ? $entry['origin'] : null];
            }
        }
        $this->removing[] = ['structure' => $structure, 'targets' => $targets];
    }

    private function endRemoval($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Structure::class) return;
        $frame = array_pop($this->removing);
        if (($frame['structure'] ?? null) !== $structure) throw new \RuntimeException('Missing native page attribute removal entry evidence');
        if ($error) return;
        $state = $this->snapshot($structure);
        unset($state['attributeRemovals']);
        $attributes = self::elementAttributes($structure);
        foreach ($frame['targets'] as $element => $targets) {
            foreach ($targets as ['name' => $name, 'present' => $present, 'origin' => $origin]) {
                if (array_key_exists($name, $attributes[$element] ?? [])) continue;
                if ($origin) self::record($origin, $present ? 'layout-page-attribute-removed' : 'layout-page-attribute-removal-target-missing');
                $displaced = $state['attributes'][$element][$name] ?? null;
                if ($present && $displaced) self::record($displaced, 'layout-page-attribute-removed-before-output');
                unset($state['attributes'][$element][$name]);
            }
        }
        foreach ($state['overridden']['page-attribute'] ?? [] as $origin) self::record($origin, 'layout-page-attribute-overridden');
        unset($state['overridden']['page-attribute']);
        $this->restore($structure, $state);
    }

    private function beginGeneration($generator, array $params, string $class, string $method): void
    {
        if ($class !== Generator::class) return;
        $state = $this->snapshot($params[0]);
        if ($method === 'processElementAttributes' && !empty($state['attributeRemovals'])) {
            throw new \RuntimeException('Missing native page attribute removal evidence');
        }
        $this->generating[] = $state;
    }

    private function endGeneration($generator, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class === Generator::class) array_pop($this->generating);
    }

    private function applyMetadata($config, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== Config::class) return;
        $caller = self::caller($config, 'setMetadata');
        $this->applyValue($config, ['metadata', $params[0]], $caller, 'processMetadata', 'metadata');
    }

    private function applyAttribute($config, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== Config::class) return;
        $caller = self::caller($config, 'setElementAttribute');
        if ($params[0] === 'body' && $params[1] === 'class'
            && !(($caller['class'] ?? null) === Config::class && ($caller['function'] ?? null) === 'addBodyClass')) {
            $state = $this->configs[$config] ?? [];
            foreach ($state['classes'] ?? [] as $origin) self::record($origin, 'layout-body-class-replaced');
            unset($state['classes']);
            $this->configs[$config] = $state;
        }
        $this->applyValue($config, ['attributes', $params[0], $params[1]], $caller, 'processElementAttributes', 'page-attribute');
    }

    private function applyValue($config, array $keys, array $caller, string $method, string $kind): void
    {
        $frame = $this->generating[array_key_last($this->generating)] ?? null;
        $state = $this->configs[$config] ?? [];
        $target = &$state;
        $source = $frame;
        foreach ($keys as $key) {
            $target = &$target[$key];
            $source = $source[$key] ?? null;
        }
        $previous = $target;
        $target = null;
        if ($frame && ($caller['class'] ?? null) === Generator::class && ($caller['function'] ?? null) === $method) {
            $target = $source;
            foreach ($frame['overridden'][$kind] ?? [] as $origin) {
                self::record($origin, $kind === 'metadata' ? 'layout-metadata-overridden' : 'layout-page-attribute-overridden');
            }
        } elseif ($previous) {
            self::record($previous, $kind === 'metadata' ? 'layout-metadata-replaced' : 'layout-page-attribute-replaced');
        }
        $this->configs[$config] = $state;
    }

    private function beginRender($renderer, array $params, string $class): void
    {
        if ($class === Renderer::class) $this->rendering[] = ['origins' => [], 'metadata' => [], 'config' => null];
    }

    private function readAttributes($config, array $params, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->rendering);
        if ($error || $class !== Config::class || $index === null) return;
        $caller = self::caller($config, 'getElementAttributes');
        if (($caller['class'] ?? null) !== Renderer::class || ($caller['function'] ?? null) !== 'renderElementAttributes') return;
        foreach ($this->configs[$config]['attributes'][$params[0]] ?? [] as $name => $origin) {
            if ($origin && array_key_exists($name, $result)) $this->rendering[$index]['origins'][] = [$origin, 'layout-page-attribute-rendered'];
        }
        if ($params[0] === 'body') {
            $tokens = array_fill_keys(explode(' ', $result['class'] ?? ''), true);
            foreach ($this->configs[$config]['classes'] ?? [] as $token => $origin) {
                if (isset($tokens[$token])) $this->rendering[$index]['origins'][] = [$origin, 'layout-body-class-rendered'];
            }
        }
    }

    private function beginClassWrite($structure, array $params, string $class): void
    {
        if ($class !== Structure::class) return;
        static $deleted;
        $deleted ??= new \ReflectionProperty(Structure::class, 'isBodyClassesDeleted');
        $this->classWrites[] = $deleted->getValue($structure);
    }

    private function endClassWrite($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Structure::class) return;
        $deleted = array_pop($this->classWrites);
        if ($error) return;
        $state = $this->snapshot($structure);
        $frame = $this->reading[array_key_last($this->reading)] ?? null;
        $caller = self::caller($structure, 'setBodyClass');
        $origin = null;
        if ($frame && $frame['structure'] === $structure && ($caller['class'] ?? null) === Body::class
            && ($caller['function'] ?? null) === 'setBodyAttributeToStructure') {
            [$ids, $context] = ($this->origin)($frame['nodes'][0]);
            $ids = array_intersect_key($ids, array_flip(['body-class', 'body-class-name', 'body-class-value']));
            if ($ids) $origin = ['ids' => array_values($ids), 'context' => $context];
        }
        if (empty($params[0])) {
            if (!$deleted) $state['class-clear'] = $origin;
        } else {
            $state['classes'][] = ['signature' => hash('sha256', (string) $params[0]), 'origin' => $origin];
        }
        $this->restore($structure, $state);
    }

    private function beginBodyClasses($generator, array $params, string $class): void
    {
        if ($class === BodyGenerator::class) $this->classGeneration[] = ['structure' => $params[0], 'queue' => []];
    }

    private function endBodyClasses($generator, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class === BodyGenerator::class) array_pop($this->classGeneration);
    }

    private function readBodyClasses($structure, array $params, $classes, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->classGeneration);
        if ($error || $class !== Structure::class || $index === null || $this->classGeneration[$index]['structure'] !== $structure) return;
        $caller = self::caller($structure, 'getBodyClasses');
        if (($caller['class'] ?? null) !== BodyGenerator::class || ($caller['function'] ?? null) !== 'processBodyClasses') return;
        $state = $this->snapshot($structure);
        if (!$classes && array_key_exists('class-clear', $state)) {
            if ($state['class-clear'] && ($state['classes'] ?? [])) self::record($state['class-clear'], 'layout-body-classes-cleared');
            foreach ($state['classes'] ?? [] as $entry) {
                if ($entry['origin']) self::record($entry['origin'], 'layout-body-class-canceled');
            }
        }
        $expected = $state['classes'] ?? [];
        if (array_column($expected, 'signature') !== array_map(static fn($value) => hash('sha256', (string) $value), $classes)) return;
        $this->classGeneration[$index]['queue'] = $expected;
    }

    private static function bodyTokens(Config $config): array
    {
        static $elements;
        $elements ??= new \ReflectionProperty(Config::class, 'elements');
        return explode(' ', $elements->getValue($config)['body']['class'] ?? '');
    }

    private function beginClassAssignment($config, array $params, string $class): void
    {
        if ($class !== Config::class) return;
        $index = array_key_last($this->classGeneration);
        $caller = self::caller($config, 'addBodyClass');
        $entry = null;
        if ($index !== null && ($caller['class'] ?? null) === BodyGenerator::class
            && ($caller['function'] ?? null) === 'processBodyClasses') {
            $entry = array_shift($this->classGeneration[$index]['queue']);
        }
        $origin = $entry && $entry['signature'] === hash('sha256', (string) $params[0]) ? $entry['origin'] : null;
        $this->classAssignments[] = ['before' => self::bodyTokens($config), 'origin' => $origin];
    }

    private function endClassAssignment($config, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Config::class) return;
        $frame = array_pop($this->classAssignments);
        if ($error || !$frame['origin']) return;
        $added = array_values(array_diff(self::bodyTokens($config), $frame['before']));
        if (!$added) {
            self::record($frame['origin'], 'layout-body-class-duplicate');
            return;
        }
        if (count($added) !== 1 || $added[0] !== $params[0]) return;
        $state = $this->configs[$config] ?? [];
        $state['classes'][$added[0]] = $frame['origin'];
        $this->configs[$config] = $state;
    }

    private function readMetadata($config, array $params, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->rendering);
        if ($error || $class !== Config::class || $index === null) return;
        $caller = self::caller($config, 'getMetadata');
        if (($caller['class'] ?? null) !== Renderer::class || ($caller['function'] ?? null) !== 'renderMetadata') return;
        $this->rendering[$index]['metadata'] = $this->configs[$config]['metadata'] ?? [];
        $this->rendering[$index]['config'] = $config;
    }

    private static function metadataValue(Config $config, string $key): ?string
    {
        static $metadata;
        $metadata ??= new \ReflectionProperty(Config::class, 'metadata');
        $value = $metadata->getRawValue($config)[$key] ?? null;
        return is_string($value) ? $value : null;
    }

    private function beginMetadataValue($config, array $params, string $class, string $method): void
    {
        if ($class !== Config::class) return;
        if (count($this->metadataReads) >= 256) throw new \RuntimeException('Native metadata getter nesting exceeded 256 calls');
        $key = self::METADATA_GETTERS[$method];
        $content = array_key_last($this->metadataContents);
        $rendering = array_key_last($this->rendering);
        $input = $this->metadataContents[$content] ?? null;
        $caller = self::caller($config, $method);
        $parent = array_key_last($this->metadataReads);
        $outer = $this->metadataReads[$parent] ?? null;
        $nested = $outer && $outer['auto'] && $outer['config'] === $config
            && ($caller['class'] ?? null) === Config::class && ($caller['function'] ?? null) === 'getContentType'
            && in_array($key, ['charset', 'media_type'], true);
        $direct = $input && $input['name'] === $key && ($caller['class'] ?? null) === Renderer::class
            && ($caller['function'] ?? null) === 'processMetadataContent';
        if ((!$nested && !$direct) || ($this->rendering[$rendering]['config'] ?? null) !== $config) {
            $this->metadataReads[] = null;
            return;
        }
        $value = self::metadataValue($config, $key);
        $this->metadataReads[] = [
            'config' => $config, 'method' => $method, 'key' => $key, 'content' => $content,
            'parent' => $nested ? $parent : null, 'inputs' => [],
            'auto' => $key === 'content_type' && $value !== null && strcasecmp($value, 'auto') === 0,
            'nonempty' => !empty($value), 'signature' => $value === null ? null : hash('sha256', $value),
        ];
    }

    private function endMetadataValue($config, array $params, $result, ?\Throwable $error, string $class, string $method): void
    {
        if ($class !== Config::class) return;
        if (!$this->metadataReads) throw new \RuntimeException('Missing native metadata getter entry evidence');
        $read = array_pop($this->metadataReads);
        if (!$read || $error) return;
        if ($read['config'] !== $config || $read['method'] !== $method) throw new \RuntimeException('Mismatched native metadata getter evidence');
        $key = $read['key'];
        $literal = is_string($result) && $read['signature'] === hash('sha256', $result);
        $applied = $literal && ($read['nonempty'] || $key === 'content_type');
        if ($read['parent'] !== null) {
            $this->metadataReads[$read['parent']]['inputs'][$key] = $applied;
            return;
        }
        $content = $read['content'];
        if ($read['auto'] && array_key_exists('media_type', $read['inputs']) && array_key_exists('charset', $read['inputs'])) {
            $this->metadataContents[$content]['effect'] = 'layout-metadata-content-type-derived';
            $this->metadataContents[$content]['inputs'] = array_keys(array_filter($read['inputs']));
        } elseif ($applied) {
            $this->metadataContents[$content]['effect'] = 'layout-metadata-rendered';
        } elseif (!$read['nonempty']) {
            $this->metadataContents[$content]['effect'] = 'layout-metadata-content-fallback';
        }
    }

    private function metadataTemplate($renderer, array $params, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->rendering);
        if ($error || $class !== Renderer::class || $index === null) return;
        $caller = self::caller($renderer, 'getMetadataTemplate');
        if (($caller['class'] ?? null) !== Renderer::class || ($caller['function'] ?? null) !== 'renderMetadata') return;
        $origin = $this->rendering[$index]['metadata'][$params[0]] ?? null;
        if ($origin && !$result) $this->rendering[$index]['origins'][] = [$origin, 'layout-metadata-template-skipped'];
    }

    private function beginMetadataContent($renderer, array $params, string $class): void
    {
        if ($class !== Renderer::class) return;
        if (count($this->metadataContents) >= 256) throw new \RuntimeException('Native metadata content nesting exceeded 256 calls');
        $caller = self::caller($renderer, 'processMetadataContent');
        $native = ($caller['class'] ?? null) === Renderer::class && ($caller['function'] ?? null) === 'renderMetadata';
        $this->metadataContents[] = ['renderer' => $renderer, 'name' => (string) $params[0], 'native' => $native,
            'nonempty' => !empty($params[1]), 'effect' => null, 'inputs' => []];
    }

    private function metadataContent($renderer, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Renderer::class) return;
        $input = array_pop($this->metadataContents);
        if (($input['renderer'] ?? null) !== $renderer) throw new \RuntimeException('Missing native metadata content entry evidence');
        $index = array_key_last($this->rendering);
        if ($error || !$input['native'] || $index === null) return;
        $frame = &$this->rendering[$index];
        $name = $input['name'];
        $origin = $frame['metadata'][$name] ?? null;
        if (!$origin) return;
        $method = 'get' . str_replace(' ', '', ucwords(str_replace('_', ' ', $name)));
        $effect = $input['effect'];
        if ($name === 'title') $effect = $input['nonempty'] ? 'layout-metadata-rendered' : 'layout-metadata-content-fallback';
        if ($effect === 'layout-metadata-content-fallback') {
            $content = array_intersect_key($origin['ids'], ['metadata-content' => true]);
            if ($content) $frame['origins'][] = [['ids' => $content, 'context' => $origin['context']], $effect];
            $key = array_diff_key($origin['ids'], $content);
            $frame['origins'][] = [['ids' => $key, 'context' => $origin['context']],
                $result ? 'layout-metadata-key-emitted' : 'layout-metadata-empty-suppressed'];
            return;
        }
        if (!$effect && method_exists($frame['config'], $method)) {
            $frame['origins'][] = [$origin, 'layout-metadata-origin-unconfirmed'];
            return;
        }
        $frame['origins'][] = [$origin, !$result ? 'layout-metadata-empty-suppressed' : ($effect ?? 'layout-metadata-rendered')];
        if (!$result) return;
        foreach ($input['inputs'] as $key) {
            if (isset($frame['metadata'][$key])) $frame['origins'][] = [$frame['metadata'][$key], 'layout-metadata-content-type-input'];
        }
    }

    private function endRender($renderer, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Renderer::class) return;
        $frame = array_pop($this->rendering);
        if (!$error) foreach ($frame['origins'] as [$origin, $effect]) self::record($origin, $effect);
    }

    private static function record(array $origin, string $effect): void
    {
        foreach ($origin['ids'] as $id) Recorder::layout($id, $effect, $origin['context']);
    }
}
