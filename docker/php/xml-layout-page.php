<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\View\Page\Config\Generator\Head as HeadGenerator;
use Magento\Framework\View\Page\Config\Reader\Head as HeadReader;
use Magento\Framework\View\Page\Config\Renderer;
use Magento\Framework\View\Page\Config\Structure;
use Magento\Framework\View\Page\Title;

final class LayoutPageCoverage
{
    private \WeakMap $structures;
    private \WeakMap $titles;
    private array $reading = [];
    private array $applying = [];
    private array $rendering = [];
    private array $removing = [];
    private LayoutPageValuesCoverage $values;
    private LayoutAssetsCoverage $assets;

    public function __construct(private readonly \Closure $origin)
    {
        $this->structures = new \WeakMap();
        $this->titles = new \WeakMap();
        $this->values = new LayoutPageValuesCoverage($origin);
        $this->assets = new LayoutAssetsCoverage($origin);
    }

    public function hooks(): array
    {
        return [
            [HeadReader::class, 'processNode', $this->beginRead(...), $this->completeRead(...)],
            [Structure::class, 'setTitle', null, $this->scheduleTitle(...)],
            [Structure::class, 'getTitle', null, $this->readScheduledTitle(...)],
            [Structure::class, 'removeAssets', null, $this->scheduleRemoval(...)],
            [Structure::class, 'populateWithArray', null, $this->replaceStructure(...)],
            [Structure::class, 'processRemoveAssets', $this->beginRemoval(...), $this->completeRemoval(...)],
            [HeadGenerator::class, 'processTitle', $this->beginApplication(...), $this->completeApplication(...)],
            [Title::class, 'set', null, $this->applyTitle(...)],
            [Title::class, 'get', null, $this->consumeTitle(...)],
            [Renderer::class, 'renderTitle', $this->beginRender(...), $this->completeRender(...)],
            ...$this->values->hooks(),
            ...$this->assets->hooks(),
        ];
    }

    public function finish(): void
    {
        $this->values->finish();
    }

    public function snapshot(Structure $structure): array
    {
        $state = $this->structures[$structure] ?? [];
        $values = $this->values->snapshot($structure);
        if ($values) $state['values'] = $values;
        $assets = $this->assets->snapshot($structure);
        if ($assets) $state['assets'] = $assets;
        return $state;
    }

    public function restore(Structure $structure, array $origins): void
    {
        $this->values->restore($structure, $origins['values'] ?? []);
        $this->assets->restore($structure, $origins['assets'] ?? []);
        unset($origins['values'], $origins['assets']);
        $this->structures[$structure] = $origins;
    }

    public function reset(Structure $structure): void
    {
        unset($this->structures[$structure]);
        $this->values->reset($structure);
        $this->assets->reset($structure);
    }

    private static function calledFrom(object $subject, string $method, string $class, string $consumer): bool
    {
        $trace = LayoutRuntimeHooks::trace(DEBUG_BACKTRACE_IGNORE_ARGS, 5);
        $caller = $trace[3] ?? [];
        $wrapper = get_class($subject);
        if (str_ends_with($wrapper, '\\Interceptor') && ($caller['class'] ?? null) === $wrapper
            && ($caller['function'] ?? null) === $method) {
            $caller = $trace[4] ?? [];
        }
        return ($caller['class'] ?? null) === $class && ($caller['function'] ?? null) === $consumer;
    }

    private function beginRead($reader, array $params, string $class): void
    {
        if ($class !== HeadReader::class) return;
        [$node, $structure] = $params;
        [$ids, $context] = ($this->origin)($node);
        $this->reading[] = ['structure' => $structure, 'ids' => $ids, 'context' => $context];
    }

    private function completeRead($reader, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class === HeadReader::class) array_pop($this->reading);
    }

    private function scheduleTitle($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== Structure::class) return;
        $state = $this->snapshot($structure);
        $read = $this->reading[array_key_last($this->reading)] ?? null;
        $origin = $read && $read['structure'] === $structure && isset($read['ids']['page-title'])
            && self::calledFrom($structure, 'setTitle', HeadReader::class, 'processNode')
            ? ['id' => $read['ids']['page-title'], 'context' => $read['context']]
            : null;
        $previous = $state['title'] ?? null;
        if (!$origin && !$previous) return;
        if ($previous && $previous !== $origin) $state['overridden'][$previous['id']] = $previous;
        $state['title'] = $origin;
        $this->restore($structure, $state);
    }

    private function scheduleRemoval($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== Structure::class) return;
        $state = $this->snapshot($structure);
        $name = $params[0];
        unset($state['removals'][$name]);
        $read = $this->reading[array_key_last($this->reading)] ?? null;
        if ($read && $read['structure'] === $structure && isset($read['ids']['asset-removal'])
            && self::calledFrom($structure, 'removeAssets', HeadReader::class, 'processNode')) {
            $ids = array_intersect_key($read['ids'], array_flip(['asset-removal', 'asset-removal-node']));
            $state['removals'][$name] = ['ids' => $ids, 'context' => $read['context']];
        }
        $this->restore($structure, $state);
    }

    private function replaceStructure($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class === Structure::class) $this->reset($structure);
    }

    private function beginRemoval($structure, array $params, string $class): void
    {
        if ($class !== Structure::class) return;
        $removals = $this->structures[$structure]['removals'] ?? [];
        $removals = array_intersect_key($removals, self::assetProperty($structure, 'removeAssets'));
        $this->removing[] = self::calledFrom($structure, 'processRemoveAssets', HeadGenerator::class, 'process') && $removals
            ? ['present' => array_keys(array_intersect_key(self::assetProperty($structure, 'assets'), $removals)), 'origins' => $removals]
            : null;
    }

    private function completeRemoval($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Structure::class) return;
        $frame = array_pop($this->removing);
        $state = $this->snapshot($structure);
        unset($state['removals']);
        $this->reset($structure);
        $this->restore($structure, $state);
        if ($error || !$frame) return;
        $assets = self::assetProperty($structure, 'assets');
        foreach ($frame['origins'] as $name => $origin) {
            if (array_key_exists($name, $assets)) continue;
            $effect = in_array($name, $frame['present'], true) ? 'layout-asset-removed' : 'layout-asset-removal-target-missing';
            foreach ($origin['ids'] as $id) Recorder::layout($id, $effect, $origin['context']);
        }
    }

    private static function assetProperty(Structure $structure, string $field): array
    {
        static $properties = [];
        $property = $properties[$field] ??= new \ReflectionProperty(Structure::class, $field);
        return $property->getRawValue($structure);
    }

    private function readScheduledTitle($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== Structure::class || $result
            || !self::calledFrom($structure, 'getTitle', HeadGenerator::class, 'processTitle')) return;
        $frame = $this->applying[array_key_last($this->applying)] ?? [];
        $origin = $frame['title'] ?? null;
        if ($origin) self::record($origin, 'layout-title-empty-ignored');
        foreach ($frame['overridden'] ?? [] as $previous) {
            if ($previous !== $origin) self::record($previous, 'layout-title-overridden');
        }
    }

    private function beginApplication($generator, array $params, string $class): void
    {
        if ($class === HeadGenerator::class) $this->applying[] = $this->snapshot($params[0]);
    }

    private function completeApplication($generator, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class === HeadGenerator::class) array_pop($this->applying);
    }

    private function applyTitle($title, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== Title::class) return;
        $previous = $this->titles[$title] ?? null;
        unset($this->titles[$title]);
        $frame = $this->applying[array_key_last($this->applying)] ?? null;
        if ($frame && self::calledFrom($title, 'set', HeadGenerator::class, 'processTitle')) {
            $selected = $frame['title'] ?? null;
            foreach ($frame['overridden'] ?? [] as $origin) {
                if ($origin !== $selected) self::record($origin, 'layout-title-overridden');
            }
            if ($selected) $this->titles[$title] = $selected;
            return;
        }
        if ($previous) self::record($previous, 'layout-title-replaced');
    }

    private function beginRender($renderer, array $params, string $class): void
    {
        if ($class === Renderer::class) $this->rendering[] = null;
    }

    private function consumeTitle($title, array $params, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->rendering);
        if (!$error && $class === Title::class && $index !== null && isset($this->titles[$title])
            && self::calledFrom($title, 'get', Renderer::class, 'renderTitle')) {
            $this->rendering[$index] = $this->titles[$title];
        }
    }

    private function completeRender($renderer, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Renderer::class) return;
        $origin = array_pop($this->rendering);
        if (!$error && $origin) self::record($origin, 'layout-title-rendered');
    }

    private static function record(array $origin, string $effect): void
    {
        Recorder::layout($origin['id'], $effect, $origin['context']);
    }
}
