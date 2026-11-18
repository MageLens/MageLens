<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\View\Element\Template;
use Magento\Framework\View\Element\Template\File\Resolver;
use Magento\ProductAlert\Model\UpdateThemeParams;

final class LayoutTemplateOwnership
{
    private array $resolving = [];
    private int $overflow = 0;
    private \WeakMap $resolved;
    private array $errors = [];

    public function __construct(private readonly LayoutXmlOwnership $ownership)
    {
        $this->resolved = new \WeakMap();
    }

    public function hooks(): array
    {
        return [...array_map(fn($target) => [$target[0], $target[1],
            function ($object, array $params, string $class, string $method) use ($target): void {
                if ($class === $target[0]) $this->begin($object, $params, $class, $method);
            },
            function ($object, array $params, $result, ?\Throwable $error, string $class, string $method) use ($target): void {
                if ($class === $target[0]) $this->complete($object, $params, $result, $error, $class, $method);
            }], [[Template::class, 'getTemplate'], [Template::class, 'getTemplateFile'], [Resolver::class, 'getTemplateFileName']]),
            [\Magento\Framework\Interception\PluginListInterface::class, 'getNext', null, $this->resolverPlugins(...)],
            [\Magento\Framework\Interception\PluginListInterface::class, 'getPlugin', null, $this->resolverPlugin(...)],
            [UpdateThemeParams::class, 'beforeGetTemplateFileName', null, $this->themeParameters(...)]];
    }

    public function watch(Template $block): void
    {
        foreach (['getTemplate', 'getTemplateFile'] as $method) {
            $this->ownership->watchProducer($block, Template::class, $method, $this->begin(...), $this->complete(...));
        }
    }

    private static function resolver(Template $block): object
    {
        static $property;
        $property ??= new \ReflectionProperty(Template::class, 'resolver');
        return $property->getValue($block);
    }

    private function begin($object, array $params, string $class, string $method): void
    {
        $native = $object instanceof Template ? Template::class : Resolver::class;
        $caller = LayoutXmlOwnership::caller($object, $method);
        $index = array_key_last($this->resolving);
        $consumer = $method === 'getTemplateFile'
            ? ($caller['class'] ?? null) === Template::class && ($caller['function'] ?? null) === '_toHtml'
            : $index !== null && ($caller['class'] ?? null) === Template::class
                && ($caller['function'] ?? null) === 'getTemplateFile'
                && ($caller['object'] ?? null) === $this->resolving[$index]['block'];
        if ($method === 'getTemplateFile' && $this->ownership->producerDepth($object, $method) === 0) {
            $resolver = self::resolver($object);
            $this->ownership->watchProducer($resolver, Resolver::class, 'getTemplateFileName', $this->begin(...), $this->complete(...));
            if ($this->overflow || count($this->resolving) >= 256) {
                $this->overflow++;
                $this->errors['Layout template resolution nesting exceeded 256 calls'] = true;
            } else {
                $this->resolving[] = ['block' => $object, 'resolver' => $resolver, 'getterObserved' => false,
                    'resolverObserved' => false, 'getterTrusted' => false, 'resolverTrusted' => false,
                    'nativeResolverObserved' => false, 'themeParameters' => false, 'pluginLookup' => false,
                    'nativePluginExpected' => false, 'beforeOnly' => false,
                    'usesSelection' => empty($params[0]), 'rendering' => $consumer];
            }
        }
        $direct = LayoutXmlOwnership::caller($object, $method, false);
        $delegated = ($direct['class'] ?? null) === get_class($object) && ($direct['function'] ?? null) === $method;
        $this->ownership->beginProducer($object, $native, $class, $method, $consumer, $delegated);
    }

    private function complete($object, array $params, $result, ?\Throwable $error, string $class, string $method): void
    {
        $proof = $this->ownership->endProducer($object, $method, $error);
        if ($method === 'getTemplateFileName' && $class === Resolver::class && !$this->overflow) {
            $index = array_key_last($this->resolving);
            if ($index !== null && $this->resolving[$index]['resolver'] === $object) {
                $this->resolving[$index]['nativeResolverObserved'] = !$error;
            }
        }
        if (!$proof['final']) return;
        if ($this->overflow) {
            if ($method === 'getTemplateFile') $this->overflow--;
            return;
        }
        $index = array_key_last($this->resolving);
        if ($index === null) return;
        $frame = $this->resolving[$index];
        if ($method === 'getTemplateFile') {
            if ($frame['block'] !== $object) {
                $this->errors['Unbalanced native template resolution hook evidence'] = true;
                return;
            }
            array_pop($this->resolving);
            if (!$error && $proof['trusted']) {
                if ($frame['usesSelection'] && LayoutXmlOwnership::nativeMethod($object, Template::class, 'getTemplate')
                    && !$frame['getterObserved']) $this->errors['Missing native template getter hook evidence'] = true;
                if ((LayoutXmlOwnership::nativeMethod($frame['resolver'], Resolver::class, 'getTemplateFileName')
                        || self::compiledThemeParameters($frame['resolver']))
                    && !$frame['resolverObserved']) $this->errors['Missing native template resolver hook evidence'] = true;
            }
            if (!$error && $frame['rendering']) {
                $this->resolved[$object] = ['file' => $result, 'trusted' => $proof['trusted']
                    && $frame['usesSelection'] && $frame['getterTrusted'] && $frame['resolverTrusted']];
            }
            return;
        }
        $caller = LayoutXmlOwnership::caller($object, $method);
        if (($caller['class'] ?? null) !== Template::class || ($caller['function'] ?? null) !== 'getTemplateFile'
            || ($caller['object'] ?? null) !== $frame['block']) return;
        if ($method === 'getTemplate' && $object === $frame['block']) {
            $this->resolving[$index]['getterObserved'] = true;
            $this->resolving[$index]['getterTrusted'] = !$error && $proof['trusted'];
        }
        if ($method === 'getTemplateFileName' && $object === $frame['resolver']) {
            $this->resolving[$index]['resolverObserved'] = true;
            $this->resolving[$index]['resolverTrusted'] = !$error && ($proof['trusted'] || $this->nativeThemeParameters($object, $frame));
        }
    }

    private function resolverPlugins($list, array $params, $result, ?\Throwable $error): void
    {
        $index = array_key_last($this->resolving);
        if ($index === null || $this->overflow || ($params[0] ?? null) !== Resolver::class
            || ($params[1] ?? null) !== 'getTemplateFileName') return;
        $resolver = $this->resolving[$index]['resolver'];
        $caller = LayoutXmlOwnership::caller($list, 'getNext');
        if (($caller['object'] ?? null) !== $resolver || ($caller['function'] ?? null) !== 'getTemplateFileName') return;
        $this->resolving[$index]['beforeOnly'] = !$error && $result === [1 => ['updateThemeParams']];
    }

    private function resolverPlugin($list, array $params, $plugin, ?\Throwable $error): void
    {
        $index = array_key_last($this->resolving);
        if ($index === null || $this->overflow || $params !== [Resolver::class, 'updateThemeParams']) return;
        $caller = LayoutXmlOwnership::caller($list, 'getPlugin');
        if (($caller['object'] ?? null) !== $this->resolving[$index]['resolver']) return;
        $this->resolving[$index]['pluginLookup'] = true;
        $this->resolving[$index]['nativePluginExpected'] = !$error && is_object($plugin)
            && (new \ReflectionMethod($plugin, 'beforeGetTemplateFileName'))->getDeclaringClass()->getName() === UpdateThemeParams::class;
    }

    private function themeParameters($plugin, array $params, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->resolving);
        if ($index === null || $this->overflow || $error || $class !== UpdateThemeParams::class
            || ($params[0] ?? null) !== $this->resolving[$index]['resolver']) return;
        $this->resolving[$index]['themeParameters'] = get_class($plugin) === UpdateThemeParams::class
            && (new \ReflectionMethod($plugin, 'beforeGetTemplateFileName'))->getDeclaringClass()->getName() === UpdateThemeParams::class;
    }

    private static function compiledThemeParameters(object $resolver): bool
    {
        if (get_class($resolver) !== Resolver::class . '\\Interceptor' || get_parent_class($resolver) !== Resolver::class
            || $resolver instanceof \Magento\Framework\Interception\InterceptorInterface) return false;
        $method = new \ReflectionMethod($resolver, 'getTemplateFileName');
        $file = $method->getFileName();
        if (!is_string($file) || !str_starts_with($file, BP . '/generated/code/') || realpath($file) !== $file) return false;
        if (filesize($file) > 262144) return false;
        $source = implode('', array_slice(file($file), $method->getStartLine() - 1, $method->getEndLine() - $method->getStartLine() + 1));
        $tokens = static function (string $code): string {
            $parts = [];
            foreach (token_get_all('<?php ' . $code) as $token) {
                if (is_array($token)) {
                    if (!in_array($token[0], [T_OPEN_TAG, T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)) $parts[] = $token[1];
                } else $parts[] = $token;
            }
            return implode('', $parts);
        };
        return $tokens($source) === $tokens(<<<'PHP'
public function getTemplateFileName($template, $params = [])
{
    $arguments = \func_get_args();
    $beforeResult = $this->____plugin_updateThemeParams()->beforeGetTemplateFileName($this, ...\array_values($arguments));
    if ($beforeResult !== null) $arguments = (array)$beforeResult;
    return parent::getTemplateFileName(...\array_values($arguments));
}
PHP);
    }

    private function nativeThemeParameters(object $resolver, array $frame): bool
    {
        $compiled = self::compiledThemeParameters($resolver);
        $standard = $resolver instanceof \Magento\Framework\Interception\InterceptorInterface && $frame['beforeOnly'];
        if (!$compiled && !$standard) return false;
        $native = $frame['nativePluginExpected'];
        if ($compiled) {
            $property = new \ReflectionProperty($resolver, '____plugin_updateThemeParams');
            $plugin = $property->getValue($resolver);
            $native = is_object($plugin) && get_class($plugin) === UpdateThemeParams::class;
        } elseif (!$frame['pluginLookup']) $this->errors['Missing native template resolver plugin lookup hook evidence'] = true;
        if ($native && !$frame['themeParameters']) $this->errors['Missing native template theme parameter hook evidence'] = true;
        if ($native && !$frame['nativeResolverObserved']) $this->errors['Missing native template resolver hook evidence'] = true;
        return $native && $frame['themeParameters'] && $frame['nativeResolverObserved'];
    }

    public function consume(Template $block, $file): bool
    {
        $proof = $this->resolved[$block] ?? null;
        unset($this->resolved[$block]);
        if ($proof === null && LayoutXmlOwnership::nativeMethod($block, Template::class, 'getTemplateFile')) {
            $this->errors['Missing native template file getter hook evidence'] = true;
        }
        return $proof !== null && $proof['trusted'] && $proof['file'] === $file;
    }

    public function finish(): void
    {
        if ($this->resolving || $this->overflow) $this->errors['Unbalanced native template resolution hook evidence'] = true;
        if ($this->errors) throw new \RuntimeException(implode(', ', array_keys($this->errors)));
    }
}
