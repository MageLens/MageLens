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
    private LayoutBeforePluginOwnership $beforePlugin;

    public function __construct(private readonly LayoutXmlOwnership $ownership)
    {
        $this->resolved = new \WeakMap();
        $this->beforePlugin = new LayoutBeforePluginOwnership([
            'native' => Resolver::class, 'method' => 'getTemplateFileName', 'name' => 'updateThemeParams',
            'plugin' => UpdateThemeParams::class, 'callback' => 'beforeGetTemplateFileName',
            'label' => 'template resolver', 'pluginLabel' => 'template theme parameter',
        ]);
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
            ...$this->beforePlugin->hooks()];
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
                $this->beforePlugin->begin($resolver);
                $this->resolving[] = ['block' => $object, 'resolver' => $resolver, 'getterObserved' => false,
                    'resolverObserved' => false, 'getterTrusted' => false, 'resolverTrusted' => false,
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
            $knownResolver = $this->beforePlugin->complete($frame['resolver'], $error, $proof['trusted'] && $frame['getterTrusted']);
            if (!$error && $proof['trusted']) {
                if ($frame['usesSelection'] && LayoutXmlOwnership::nativeMethod($object, Template::class, 'getTemplate')
                    && !$frame['getterObserved']) $this->errors['Missing native template getter hook evidence'] = true;
                if ($frame['getterTrusted'] && (LayoutXmlOwnership::nativeMethod($frame['resolver'], Resolver::class, 'getTemplateFileName')
                        || $this->beforePlugin->compiled($frame['resolver']))
                    && !$frame['resolverObserved']) $this->errors['Missing native template resolver hook evidence'] = true;
            }
            if (!$error && $frame['rendering']) {
                $this->resolved[$object] = ['file' => $result, 'trusted' => $proof['trusted']
                    && $frame['usesSelection'] && $frame['getterTrusted'] && ($frame['resolverTrusted'] || $knownResolver)];
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
            $this->resolving[$index]['resolverTrusted'] = !$error && $proof['trusted'];
        }
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
        $this->beforePlugin->finish();
        if ($this->resolving || $this->overflow) $this->errors['Unbalanced native template resolution hook evidence'] = true;
        if ($this->errors) throw new \RuntimeException(implode(', ', array_keys($this->errors)));
    }
}
