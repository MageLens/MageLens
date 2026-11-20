<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

final class LayoutBeforePluginOwnership
{
    private const PLUGIN_NAME_SLOT = '{PLUGIN_NAME}';
    private const PLUGIN_CALLBACK_SLOT = '{PLUGIN_CALLBACK}';
    private const NATIVE_METHOD_SLOT = '{NATIVE_METHOD}';

    private array $calls = [];
    private int $overflow = 0;
    private array $errors = [];

    public function __construct(private readonly array $descriptor)
    {
    }

    public function hooks(): array
    {
        return [
            [\Magento\Framework\Interception\PluginListInterface::class, 'getNext', null, $this->selected(...)],
            [\Magento\Framework\Interception\PluginListInterface::class, 'getPlugin', null, $this->lookedUp(...)],
            [$this->descriptor['plugin'], $this->descriptor['callback'], null, $this->calledPlugin(...)],
            [$this->descriptor['native'], $this->descriptor['method'], null, $this->calledNative(...)],
        ];
    }

    public function begin(object $object, ?array $inputs = null): void
    {
        if ($this->overflow || count($this->calls) >= 256) {
            $this->overflow++;
            $this->errors['Layout before-plugin nesting exceeded 256 calls'] = true;
            return;
        }
        $this->calls[] = ['object' => $object, 'beforeOnly' => false, 'lookup' => false,
            'nativePlugin' => false, 'pluginObserved' => false, 'nativeObserved' => false,
            'inputs' => $inputs, 'matchingInputs' => false];
    }

    private function selected($list, array $params, $result, ?\Throwable $error): void
    {
        $index = array_key_last($this->calls);
        if ($index === null || $this->overflow) return;
        $object = $this->calls[$index]['object'];
        if (!$object instanceof \Magento\Framework\Interception\InterceptorInterface
            || !LayoutXmlOwnership::nativeMethod($object, $this->descriptor['native'], $this->descriptor['method'])
            || array_slice($params, 0, 2) !== [get_parent_class($object), $this->descriptor['method']]) return;
        $caller = LayoutXmlOwnership::caller($list, 'getNext');
        if (($caller['object'] ?? null) !== $this->calls[$index]['object']
            || ($caller['function'] ?? null) !== $this->descriptor['method']) return;
        $this->calls[$index]['beforeOnly'] = !$error && $result === [
            \Magento\Framework\Interception\DefinitionInterface::LISTENER_BEFORE => [$this->descriptor['name']],
        ];
    }

    private function lookedUp($list, array $params, $plugin, ?\Throwable $error): void
    {
        $index = array_key_last($this->calls);
        if ($index === null || $this->overflow || $params !== [get_parent_class($this->calls[$index]['object']), $this->descriptor['name']]) return;
        $caller = LayoutXmlOwnership::caller($list, 'getPlugin');
        if (($caller['object'] ?? null) !== $this->calls[$index]['object']) return;
        $this->calls[$index]['lookup'] = true;
        $this->calls[$index]['nativePlugin'] = !$error && is_object($plugin) && get_class($plugin) === $this->descriptor['plugin'];
    }

    private function calledPlugin($plugin, array $params, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->calls);
        if ($index === null || $this->overflow || $error || $class !== $this->descriptor['plugin']
            || ($params[0] ?? null) !== $this->calls[$index]['object']) return;
        $this->calls[$index]['pluginObserved'] = get_class($plugin) === $this->descriptor['plugin']
            && (new \ReflectionMethod($plugin, $this->descriptor['callback']))->getDeclaringClass()->getName() === $class;
    }

    private function calledNative($object, array $params, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->calls);
        if ($index !== null && !$this->overflow && $class === $this->descriptor['native']
            && $this->calls[$index]['object'] === $object) {
            $this->calls[$index]['nativeObserved'] = true;
            $inputs = $this->calls[$index]['inputs'];
            $this->calls[$index]['matchingInputs'] = $inputs === null || array_slice($params, 0, count($inputs)) === $inputs;
        }
    }

    public function compiled(object $object): bool
    {
        $native = $this->descriptor['native'];
        $parent = get_parent_class($object);
        if (!$parent || get_class($object) !== $parent . '\\Interceptor' || !is_a($parent, $native, true)
            || (new \ReflectionMethod($parent, $this->descriptor['method']))->getDeclaringClass()->getName() !== $native
            || $object instanceof \Magento\Framework\Interception\InterceptorInterface) return false;
        $method = new \ReflectionMethod($object, $this->descriptor['method']);
        $file = $method->getFileName();
        if (!is_string($file) || !is_readable($file) || !str_starts_with($file, BP . '/generated/code/') || realpath($file) !== $file
            || filesize($file) > 262144) return false;
        $expected = <<<'PHP'
{
    $arguments = \func_get_args();
    $beforeResult = $this->____plugin_{PLUGIN_NAME}()->{PLUGIN_CALLBACK}($this, ...\array_values($arguments));
    if ($beforeResult !== null) $arguments = (array)$beforeResult;
    return parent::{NATIVE_METHOD}(...\array_values($arguments));
}
PHP;
        $expected = strtr($expected, [
            self::PLUGIN_NAME_SLOT => $this->descriptor['name'],
            self::PLUGIN_CALLBACK_SLOT => $this->descriptor['callback'],
            self::NATIVE_METHOD_SLOT => $this->descriptor['method'],
        ]);
        return LayoutXmlOwnership::bodyMatches($method, $expected);
    }

    public function complete(object $object, ?\Throwable $error, bool $required = true): bool
    {
        if ($this->overflow) { $this->overflow--; return false; }
        $frame = array_pop($this->calls);
        if (!$frame || $frame['object'] !== $object) {
            $this->errors['Unbalanced native before-plugin hook evidence'] = true;
            return false;
        }
        if (!$required) return false;
        $compiled = $this->compiled($object);
        $standard = $object instanceof \Magento\Framework\Interception\InterceptorInterface && $frame['beforeOnly'];
        if ($error || !$compiled && !$standard) return false;
        $native = $frame['nativePlugin'];
        if ($compiled) {
            $property = new \ReflectionProperty($object, '____plugin_' . $this->descriptor['name']);
            $plugin = $property->getValue($object);
            $native = is_object($plugin) && get_class($plugin) === $this->descriptor['plugin'];
        } elseif (!$frame['lookup']) $this->errors['Missing native ' . $this->descriptor['label'] . ' plugin lookup hook evidence'] = true;
        if ($native && !$frame['pluginObserved']) $this->errors['Missing native ' . $this->descriptor['pluginLabel'] . ' hook evidence'] = true;
        if ($native && !$frame['nativeObserved']) $this->errors['Missing native ' . $this->descriptor['label'] . ' hook evidence'] = true;
        return $native && $frame['pluginObserved'] && $frame['nativeObserved'] && $frame['matchingInputs'];
    }

    public function finish(): void
    {
        if ($this->calls || $this->overflow) $this->errors['Unbalanced native before-plugin hook evidence'] = true;
        if ($this->errors) throw new \RuntimeException(implode(', ', array_keys($this->errors)));
    }
}
