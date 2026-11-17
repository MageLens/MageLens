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
    private \WeakMap $scheduled;
    private \WeakMap $configs;
    private array $reading = [];
    private array $generating = [];
    private array $rendering = [];
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
            [Generator::class, 'processMetadata', $this->beginGeneration(...), $this->endGeneration(...)],
            [Generator::class, 'processElementAttributes', $this->beginGeneration(...), $this->endGeneration(...)],
            [Config::class, 'setMetadata', null, $this->applyMetadata(...)],
            [Config::class, 'setElementAttribute', null, $this->applyAttribute(...)],
            [Config::class, 'getMetadata', null, $this->readMetadata(...)],
            [Config::class, 'getElementAttributes', null, $this->readAttributes(...)],
            [Config::class, 'getDescription', null, $this->readDescription(...)],
            [Renderer::class, 'renderElementAttributes', $this->beginRender(...), $this->endRender(...)],
            [Renderer::class, 'renderMetadata', $this->beginRender(...), $this->endRender(...)],
            [Renderer::class, 'processMetadataContent', null, $this->metadataContent(...)],
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

    private static function caller(object $subject, string $method): array
    {
        $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 5);
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
        $this->scheduleValue($structure, ['metadata', $params[0]], $caller, Head::class, 'setMetadata', 'metadata');
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
        $this->scheduleValue($structure, ['attributes', $params[0], $params[1]], $caller, $reader, $method, 'page-attribute');
    }

    private function scheduleValue($structure, array $keys, array $caller, ?string $reader, string $method, string $kind): void
    {
        $state = $this->snapshot($structure);
        $target = &$state;
        foreach ($keys as $key) $target = &$target[$key];
        $previous = $target;
        $target = null;
        $index = array_key_last($this->reading);
        $frame = $this->reading[$index] ?? null;
        if ($frame && $frame['structure'] === $structure && ($caller['class'] ?? null) === $reader
            && ($caller['function'] ?? null) === $method) {
            $node = $frame['nodes'][$frame['index']] ?? null;
            $this->reading[$index]['index']++;
            if ($node) {
                [$ids, $context] = ($this->origin)($node);
                $ids = array_intersect_key($ids, array_flip([$kind, $kind . '-name', $kind . '-value', $kind . '-content']));
                if ($ids) $target = ['ids' => array_values($ids), 'context' => $context];
            }
        }
        if ($previous && $previous !== $target) $state['overridden'][$kind][] = $previous;
        $this->restore($structure, $state);
    }

    private function beginGeneration($generator, array $params, string $class): void
    {
        if ($class === Generator::class) $this->generating[] = $this->snapshot($params[0]);
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
        if ($class === Renderer::class) $this->rendering[] = ['origins' => [], 'metadata' => [], 'config' => null, 'description' => false];
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

    private function readDescription($config, array $params, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->rendering);
        if ($error || $class !== Config::class || $index === null || !$result
            || $this->rendering[$index]['config'] !== $config) return;
        $caller = self::caller($config, 'getDescription');
        if (($caller['class'] ?? null) === Renderer::class && ($caller['function'] ?? null) === 'processMetadataContent') {
            $this->rendering[$index]['description'] = true;
        }
    }

    private function metadataContent($renderer, array $params, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->rendering);
        if ($error || $class !== Renderer::class || $index === null || !$result) return;
        $frame = $this->rendering[$index];
        $name = $params[0];
        $origin = $frame['metadata'][$name] ?? null;
        if (!$origin) return;
        $method = 'get' . str_replace(' ', '', ucwords(str_replace('_', ' ', $name)));
        if ($name === 'description' ? !$frame['description'] : method_exists($frame['config'], $method)) return;
        $this->rendering[$index]['origins'][] = [$origin, 'layout-metadata-rendered'];
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
