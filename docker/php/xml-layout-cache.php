<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\App\Cache\State;
use Magento\Framework\App\Cache\Type\AccessProxy;
use Magento\Framework\View\Element\AbstractBlock;
use Magento\Framework\View\Layout;
use Magento\Framework\View\Layout\ScheduledStructure;
use Magento\Framework\View\Model\Layout\Merge;

final class LayoutCacheCoverage
{
    public static function isolateLayoutCache(): void
    {
        // Only the native layout cache's reads and writes are bypassed. Cache
        // state and maintenance operations continue to see the real setting.
        if (!\OpenTelemetry\Instrumentation\hook(State::class, 'isEnabled', null, self::layoutCacheEnabled(...))) {
            throw new \RuntimeException('Cannot initialize request-local layout cache isolation');
        }
    }

    private static function layoutCacheEnabled($state, array $params, $enabled, ?\Throwable $error, string $class): mixed
    {
        if ($error || $class !== State::class || !$enabled || ($params[0] ?? null) !== 'layout') return $enabled;
        $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 4);
        if (($trace[2]['class'] ?? null) === AccessProxy::class && ($trace[2]['function'] ?? null) === '_isEnabled'
            && ($trace[3]['class'] ?? null) === AccessProxy::class
            && in_array($trace[3]['function'], ['test', 'load', 'save'], true)) {
            return false;
        }
        return $enabled;
    }

    private array $loadingPages = [];
    private int $loadingPagesOverflow = 0;
    private array $loadingHtml = [];
    private int $loadingHtmlOverflow = 0;
    private bool $sourceTrace = false;
    private array $scopedLimitations = [];
    private array $measuredHandles = [];
    private \WeakMap $cachedPackages;
    private array $limitations = [];
    private array $errors = [];
    private bool $healthy = false;

    public function __construct(array $sources, private readonly \Closure $observedContext,
        private readonly \Closure $layoutUpdate, private readonly \Closure $resetSchedule,
        private readonly \Closure $completeBlock)
    {
        foreach ($sources as $path) $this->measuredHandles[basename($path, '.xml')] = true;
        $this->cachedPackages = new \WeakMap();
    }

    public function hooks(): array
    {
        return [
            [Merge::class, '_loadCache', null, $this->cachedUpdate(...)],
            [ScheduledStructure::class, 'populateWithArray', null, $this->cachedStructure(...)],
            [\Magento\Framework\App\PageCache\Kernel::class, 'load', $this->beginPageCache(...), $this->loadedPageCache(...)],
            [AbstractBlock::class, '_loadCache', $this->beginBlockHtml(...), $this->loadBlockHtml(...)],
            [\Magento\Framework\App\CacheInterface::class, 'load', null, $this->loadedBlockCache(...)],
            [\Magento\Framework\Cache\LockGuardedCacheLoader::class, 'lockedLoadData', $this->beginBlockCacheLoader(...), null],
        ];
    }

    public function traced(): void
    {
        $this->sourceTrace = true;
    }

    public function completedHandle(Merge $merge, string|int $handle): void
    {
        if (isset($this->cachedPackages[$merge])) $this->limitHandles('layout-package-cache', $merge, [$handle]);
    }

    public function finish(): array
    {
        if ($this->loadingPages || $this->loadingPagesOverflow) $this->errors['Unbalanced full-page cache hook evidence'] = true;
        if ($this->loadingHtml || $this->loadingHtmlOverflow) $this->errors['Unbalanced block HTML cache hook evidence'] = true;
        if ($this->errors) throw new \RuntimeException(implode('; ', array_keys($this->errors)));
        return [$this->healthy, $this->sourceTrace, array_keys($this->limitations), array_values($this->scopedLimitations)];
    }

    private function cachedUpdate($merge, array $params, $value, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== Merge::class || !$value) return;
        $caller = LayoutRuntimeHooks::trace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? [];
        if (($caller['class'] ?? null) !== Merge::class) return;
        $reason = match ($caller['function'] ?? null) {
            'load' => 'layout-merge-cache',
            'getFileLayoutUpdatesXml' => 'layout-package-cache',
            default => null,
        };
        if ($reason === 'layout-package-cache') {
            $this->cachedPackages[$merge] = true;
            $this->limitations[$reason] = true;
        } elseif ($reason === 'layout-merge-cache') {
            $this->limitHandles($reason, $merge);
        }
    }

    public function limitHandles(string $reason, $merge, ?array $selected = null): void
    {
        $this->limitations[$reason] = true;
        if (!$merge instanceof Merge) return;
        $context = ($this->observedContext)($merge);
        $area = $context['area'] ?? null;
        if (!in_array($area, ['frontend', 'adminhtml'], true)) return;
        if ($selected === null) {
            $property = LayoutXmlOwnership::unhookedProperty($merge, 'handles');
            if ($property?->getDeclaringClass()->getName() !== Merge::class
                || !LayoutXmlOwnership::nativeMethod($merge, Merge::class, 'getHandles')) return;
            $storage = $property->getRawValue($merge);
            if (!is_array($storage)) return;
            $selected = array_keys($storage);
        }
        foreach ($selected as $handle) {
            if (is_int($handle)) $handle = (string) $handle;
            // Request logs retain only handles present in the original source inventory.
            if (!is_string($handle) || !isset($this->measuredHandles[$handle])) continue;
            $key = $reason . "\0" . $area;
            $this->scopedLimitations[$key]['reason'] = $reason;
            $this->scopedLimitations[$key]['area'] = $area;
            if (!in_array($handle, $this->scopedLimitations[$key]['handles'] ?? [], true)) {
                $this->scopedLimitations[$key]['handles'][] = $handle;
            }
        }
    }

    private function cachedStructure($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== ScheduledStructure::class) return;
        ($this->resetSchedule)($structure);
        $caller = LayoutRuntimeHooks::trace(DEBUG_BACKTRACE_PROVIDE_OBJECT | DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? [];
        if (($caller['class'] ?? null) === Layout::class && ($caller['function'] ?? null) === 'generateElements') {
            $this->limitHandles('scheduled-layout-cache', ($this->layoutUpdate)($caller['object']));
        }
    }

    private function beginPageCache($kernel, array $params, string $class): void
    {
        if ($class !== \Magento\Framework\App\PageCache\Kernel::class) return;
        if (count($this->loadingPages) >= 256 || $this->loadingPagesOverflow) {
            $this->loadingPagesOverflow++;
            $this->errors['Layout full-page cache nesting exceeded 256 calls'] = true;
            return;
        }
        $this->loadingPages[] = $kernel;
    }

    private function loadedPageCache($kernel, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== \Magento\Framework\App\PageCache\Kernel::class) return;
        if ($this->loadingPagesOverflow) { $this->loadingPagesOverflow--; return; }
        if (array_pop($this->loadingPages) !== $kernel) {
            $this->errors['Unbalanced full-page cache hook evidence'] = true;
            return;
        }
        if ($error) return;
        $this->healthy = true;
        if ($result instanceof \Magento\Framework\App\Response\Http) {
            $this->limitations['full-page-cache-origin'] = true;
        }
    }

    private function loadBlockHtml($block, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== AbstractBlock::class) return;
        if ($this->loadingHtmlOverflow) { $this->loadingHtmlOverflow--; return; }
        $frame = array_pop($this->loadingHtml);
        if (!$frame || $frame['block'] !== $block) {
            $this->errors['Unbalanced block HTML cache hook evidence'] = true;
            return;
        }
        if ($error) return;
        if ($frame['readExpected'] && !$frame['readObserved']) $this->errors['Missing native block HTML cache read hook evidence'] = true;
        if ($frame['readObserved'] && $frame['loaderExpected'] && !$frame['loaderObserved']) {
            $this->errors['Missing native block HTML cache loader hook evidence'] = true;
        }
        if ($frame['cacheData']) $this->limitations['block-html-cache-origin'] = true;
        $caller = LayoutRuntimeHooks::trace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? [];
        $fromRender = ($caller['class'] ?? null) === AbstractBlock::class && ($caller['function'] ?? null) === 'toHtml';
        ($this->completeBlock)($block, $frame['cacheData'], $fromRender);
    }

    private function beginBlockHtml($block, array $params, string $class): void
    {
        if ($class !== AbstractBlock::class) return;
        if ($this->loadingHtmlOverflow || count($this->loadingHtml) >= 256) {
            $this->loadingHtmlOverflow++;
            $this->errors['Layout block HTML cache nesting exceeded 256 calls'] = true;
            return;
        }
        static $property;
        $property ??= new \ReflectionProperty(AbstractBlock::class, 'lockQuery');
        // This native private slot is distinct from any same-named subclass
        // property. An unset slot must not invoke application magic access.
        $loader = !(new \ReflectionClass($block))->isUninitializedLazyObject($block) && $property->isInitialized($block)
            ? $property->getRawValue($block) : null;
        $this->loadingHtml[] = ['block' => $block, 'cacheData' => false, 'readObserved' => false,
            'readExpected' => false, 'readClosure' => null, 'loaderObserved' => false, 'loaderExpected' => is_object($loader)
                && method_exists($loader, 'lockedLoadData')
                && (new \ReflectionMethod($loader, 'lockedLoadData'))->getDeclaringClass()->getName()
                    === \Magento\Framework\Cache\LockGuardedCacheLoader::class];
    }

    private function beginBlockCacheLoader($loader, array $params, string $class): void
    {
        $index = array_key_last($this->loadingHtml);
        if ($index === null || $this->loadingHtmlOverflow || $class !== \Magento\Framework\Cache\LockGuardedCacheLoader::class) return;
        $caller = LayoutXmlOwnership::caller($loader, 'lockedLoadData');
        if (($caller['class'] ?? null) !== AbstractBlock::class || ($caller['function'] ?? null) !== '_loadCache'
            || ($caller['object'] ?? null) !== $this->loadingHtml[$index]['block']) return;
        $this->loadingHtml[$index]['loaderObserved'] = true;
        $callback = $params[1] ?? null;
        if (!$callback instanceof \Closure) return;
        $function = new \ReflectionFunction($callback);
        $this->loadingHtml[$index]['readExpected'] = $function->getClosureThis() === $this->loadingHtml[$index]['block']
            && $function->getClosureScopeClass()?->getName() === AbstractBlock::class
            && $function->getFileName() === (new \ReflectionMethod(AbstractBlock::class, '_loadCache'))->getFileName()
            && LayoutXmlOwnership::bodyMatches($function, '{ return $this->_cache->load($this->getCacheKey()); }');
        if ($this->loadingHtml[$index]['readExpected']) $this->loadingHtml[$index]['readClosure'] = $function->getName();
    }

    private function loadedBlockCache($cache, array $params, $result, ?\Throwable $error): void
    {
        $index = array_key_last($this->loadingHtml);
        if ($error || $index === null || $this->loadingHtmlOverflow) return;
        $caller = LayoutXmlOwnership::caller($cache, 'load', false);
        if (($caller['class'] ?? null) !== AbstractBlock::class
            || !str_starts_with($caller['function'] ?? '', '{closure:' . AbstractBlock::class . '::_loadCache')
            || ($caller['object'] ?? null) !== $this->loadingHtml[$index]['block']) return;
        if ($this->loadingHtml[$index]['readClosure'] !== null && $caller['function'] !== $this->loadingHtml[$index]['readClosure']) return;
        $this->loadingHtml[$index]['readObserved'] = true;
        if (is_string($result)) $this->loadingHtml[$index]['cacheData'] = true;
    }
}
