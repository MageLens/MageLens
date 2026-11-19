<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\Event\{Config, ConfigInterface, InvokerInterface, Manager, ManagerInterface};
use Magento\Framework\Event\Invoker\InvokerDefault;

/** Follow the native event handoff of Hyva's mutable package document. */
final class LayoutPackageEvents
{
    private array $dispatching = [];
    private array $invoking = [];
    private array $errors = [];
    private int $dispatchOverflow = 0;
    private int $invokeOverflow = 0;

    public function __construct(private readonly \Closure $known, private readonly \Closure $revoke)
    {
    }

    public function hooks(): array
    {
        return [
            [ManagerInterface::class, 'dispatch', $this->beginDispatch(...), $this->endDispatch(...)],
            [ConfigInterface::class, 'getObservers', null, $this->observers(...)],
            [InvokerInterface::class, 'dispatch', $this->beginInvoke(...), $this->endInvoke(...)],
            [InvokerDefault::class, '_callObserverMethod', $this->callObserver(...), null],
            ['Hyva\\Theme\\Framework\\View\\Model\\Layout\\Merge', '_loadFileLayoutUpdatesXml', null, $this->packageLoaded(...)],
        ];
    }

    public function finish(): void
    {
        if ($this->errors) throw new \RuntimeException(implode(', ', array_keys($this->errors)));
    }

    private static function native(object $object, string $native, string $method): bool
    {
        return get_class($object) === $native
            && (new \ReflectionMethod($object, $method))->getDeclaringClass()->getName() === $native;
    }

    private function beginDispatch($manager, array $params): void
    {
        $xml = ($params[0] ?? null) === 'load_file_layout_updates_xml_after' ? ($params[1]['layoutXml'] ?? null) : null;
        $tracked = ($xml instanceof \SimpleXMLElement || $xml instanceof \DOMNode) && ($this->known)($xml, true);
        $native = self::native($manager, Manager::class, 'dispatch');
        $proxy = get_class($manager) === Manager\Proxy::class;
        if ($tracked && !$native && !$proxy) ($this->revoke)($xml);
        if ($this->dispatchOverflow || count($this->dispatching) >= 256) {
            $this->errors['Layout event nesting exceeded 256 calls'] = true;
            if ($tracked) ($this->revoke)($xml);
            $this->dispatchOverflow++;
            return;
        }
        if ($tracked && $native) {
            foreach ($this->dispatching as &$parent) {
                if ($parent !== null && $parent['proxy']) $parent['delegated'] = true;
            }
            unset($parent);
        }
        $this->dispatching[] = $tracked ? ['xml' => $xml, 'native' => $native, 'proxy' => $proxy,
            'delegated' => false, 'expected' => null, 'invoked' => 0] : null;
    }

    private function endDispatch($manager, array $params, $result, ?\Throwable $error): void
    {
        if ($this->dispatchOverflow) {
            $this->dispatchOverflow--;
            return;
        }
        $frame = array_pop($this->dispatching);
        if (!$frame || $error) return;
        if ($frame['native'] && ($frame['expected'] === null || $frame['expected'] !== $frame['invoked'])) {
            $this->errors['Missing native layout event dispatch hook evidence'] = true;
        }
        if ($frame['proxy'] && !$frame['delegated']) $this->errors['Missing native layout event manager hook evidence'] = true;
    }

    private function observers($config, array $params, $result, ?\Throwable $error): void
    {
        $index = array_key_last($this->dispatching);
        $caller = LayoutRuntimeHooks::trace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? [];
        if ($index === null || !$this->dispatching[$index] || !$this->dispatching[$index]['native']
            || ($caller['class'] ?? null) !== Manager::class || ($caller['function'] ?? null) !== 'dispatch') return;
        if ($error || !is_array($result) || !self::native($config, Config::class, 'getObservers')) {
            ($this->revoke)($this->dispatching[$index]['xml']);
        }
        $this->dispatching[$index]['expected'] = is_array($result) ? count($result) : 0;
    }

    private function beginInvoke($invoker, array $params): void
    {
        if ($this->invokeOverflow || count($this->invoking) >= 256) {
            $this->invokeOverflow++;
            $this->errors['Layout observer nesting exceeded 256 calls'] = true;
            return;
        }
        $index = array_key_last($this->dispatching);
        $caller = LayoutRuntimeHooks::trace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? [];
        if ($index === null || !$this->dispatching[$index] || !$this->dispatching[$index]['native']
            || ($caller['class'] ?? null) !== Manager::class || ($caller['function'] ?? null) !== 'dispatch') {
            $this->invoking[] = null;
            return;
        }
        $this->dispatching[$index]['invoked']++;
        $native = self::native($invoker, InvokerDefault::class, 'dispatch');
        $xml = $this->dispatching[$index]['xml'];
        if (!$native) ($this->revoke)($xml);
        $this->invoking[] = ['xml' => $xml, 'native' => $native, 'called' => false,
            'disabled' => ($params[0]['disabled'] ?? null) === true];
    }

    private function endInvoke($invoker, array $params, $result, ?\Throwable $error): void
    {
        if ($this->invokeOverflow) {
            $this->invokeOverflow--;
            return;
        }
        $frame = array_pop($this->invoking);
        if ($frame && !$error && $frame['native'] && !$frame['disabled'] && !$frame['called']) {
            $this->errors['Missing native layout observer hook evidence'] = true;
        }
    }

    private function callObserver($invoker, array $params): void
    {
        $frame = array_key_last($this->invoking);
        if ($frame === null || !$this->invoking[$frame]) return;
        $this->invoking[$frame]['called'] = true;
        $observer = $params[0] ?? null;
        if (!is_object($observer) || !self::native($observer, 'Hyva\\Theme\\Observer\\AddLayoutHandlesUpdates', 'execute')) {
            ($this->revoke)($this->invoking[$frame]['xml']);
        }
    }

    private function packageLoaded($merge, array $params, $xml, ?\Throwable $error): void
    {
        if ($error || (!$xml instanceof \SimpleXMLElement && !$xml instanceof \DOMNode)) return;
        if (($this->known)($xml, false) === false) $this->errors['Missing native layout package event hook evidence'] = true;
    }
}
