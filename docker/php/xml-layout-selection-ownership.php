<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\Interception\{DefinitionInterface, PluginListInterface};
use Magento\Framework\View\Layout\ProcessorInterface;
use Magento\Framework\View\Model\Layout\Merge;

/** Verify the getter's final handoff, including the installed Mage-OS after plugin. */
final class LayoutSelectionOwnership
{
    private const PLUGIN = 'MageOS\\ShoppingFeed\\Plugin\\Adminhtml\\FeedEditorTheme';
    private const NAME = 'shopping_feed_editor_layout';
    private array $reading = [];
    private int $overflow = 0;
    private int $nativeBodies = 0;
    private int $observedBodies = 0;
    private array $errors = [];

    public function __construct(private readonly LayoutXmlOwnership $ownership, private readonly \Closure $consume)
    {
    }

    public function hooks(): array
    {
        return [[ProcessorInterface::class, 'getPageLayout', $this->begin(...), $this->complete(...)],
            [Merge::class, 'getPageLayout', $this->expectNative(...), null],
            [PluginListInterface::class, 'getNext', null, $this->selected(...)],
            [PluginListInterface::class, 'getPlugin', null, $this->lookedUp(...)],
            [self::PLUGIN, 'afterGetPageLayout', $this->beginPlugin(...), $this->completePlugin(...)],
            [self::PLUGIN, 'isFeedEditor', null, $this->condition(...)]];
    }

    public static function signature($value): ?string
    {
        return $value === null ? hash('sha256', 'null')
            : (is_string($value) && strlen($value) <= 4096 ? hash('sha256', "string\0" . $value) : null);
    }

    private function expectNative($merge, array $params, string $class): void
    {
        if ($class === Merge::class && ++$this->nativeBodies > 65536) $this->errors['Page-layout getter observations exceeded 65536 calls'] = true;
    }

    private function begin($merge, array $params, string $class): void
    {
        if (!$merge instanceof Merge) return;
        if ($class === Merge::class) $this->observedBodies++;
        if ($this->ownership->producerDepth($merge, 'getPageLayout') === 0) {
            if ($this->overflow || count($this->reading) >= 256) {
                $this->overflow++;
                $this->errors['Page-layout getter nesting exceeded 256 calls'] = true;
            } else $this->reading[] = ['merge' => $merge, 'native' => false, 'signature' => null,
                'afterOnly' => false, 'lookup' => null, 'plugin' => null, 'active' => false,
                'pluginObserved' => false, 'conditionObserved' => false, 'passThrough' => false,
                'matchingInput' => false, 'matchingOutput' => false];
        }
        $caller = LayoutXmlOwnership::caller($merge, 'getPageLayout', false);
        $delegated = ($caller['class'] ?? null) === get_class($merge) && ($caller['function'] ?? null) === 'getPageLayout';
        $this->ownership->beginProducer($merge, Merge::class, $class, 'getPageLayout', true, $delegated);
    }

    private function selected($list, array $params, $result, ?\Throwable $error): void
    {
        $index = array_key_last($this->reading);
        if ($index === null || $this->overflow) return;
        $merge = $this->reading[$index]['merge'];
        if (!LayoutXmlOwnership::nativeMethod($merge, Merge::class, 'getPageLayout')) return;
        $caller = LayoutXmlOwnership::caller($list, 'getNext');
        if (($caller['object'] ?? null) !== $merge || ($caller['function'] ?? null) !== 'getPageLayout'
            || array_slice($params, 0, 2) !== [get_parent_class($merge), 'getPageLayout']) return;
        $this->reading[$index]['afterOnly'] = !$error && $result === [DefinitionInterface::LISTENER_AFTER => [self::NAME]];
    }

    private function lookedUp($list, array $params, $plugin, ?\Throwable $error): void
    {
        $index = array_key_last($this->reading);
        if ($index === null || $this->overflow) return;
        $merge = $this->reading[$index]['merge'];
        if ($params !== [get_parent_class($merge), self::NAME]
            || (LayoutXmlOwnership::caller($list, 'getPlugin')['object'] ?? null) !== $merge) return;
        $this->reading[$index]['lookup'] = !$error && is_object($plugin) ? $plugin : null;
    }

    private function beginPlugin($plugin, array $params, string $class): void
    {
        $index = array_key_last($this->reading);
        if ($index === null || $this->overflow || $class !== self::PLUGIN || get_class($plugin) !== self::PLUGIN
            || ($params[0] ?? null) !== $this->reading[$index]['merge']) return;
        $this->reading[$index]['plugin'] = $plugin;
        $this->reading[$index]['active'] = true;
        $this->reading[$index]['matchingInput'] = self::signature($params[1] ?? null) === $this->reading[$index]['signature'];
    }

    private function condition($plugin, array $params, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->reading);
        if ($index === null || $this->overflow || $class !== self::PLUGIN
            || !$this->reading[$index]['active'] || $this->reading[$index]['plugin'] !== $plugin) return;
        $caller = LayoutXmlOwnership::caller($plugin, 'isFeedEditor');
        if (($caller['class'] ?? null) !== self::PLUGIN || ($caller['function'] ?? null) !== 'afterGetPageLayout') return;
        $this->reading[$index]['conditionObserved'] = !$error;
        $this->reading[$index]['passThrough'] = !$error && $result === false;
    }

    private function completePlugin($plugin, array $params, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->reading);
        if ($index === null || $this->overflow || $class !== self::PLUGIN || $this->reading[$index]['plugin'] !== $plugin) return;
        $this->reading[$index]['active'] = false;
        $this->reading[$index]['pluginObserved'] = !$error;
        $this->reading[$index]['matchingOutput'] = !$error && self::signature($result) === $this->reading[$index]['signature'];
    }

    private static function compiledPath(Merge $merge): ?string
    {
        $class = get_class($merge);
        $parent = get_parent_class($merge);
        if (!$parent || $class !== $parent . '\\Interceptor' || !is_a($parent, Merge::class, true)
            || $merge instanceof \Magento\Framework\Interception\InterceptorInterface
            || (new \ReflectionMethod($parent, 'getPageLayout'))->getDeclaringClass()->getName() !== Merge::class) return null;
        $method = new \ReflectionMethod($merge, 'getPageLayout');
        $file = $method->getFileName();
        if (!is_string($file) || !str_starts_with($file, BP . '/generated/code/')) return null;
        $expected = <<<'PHP'
{
    switch ($this->____scope->getCurrentScope()) {
        case 'adminhtml':
            $arguments = \func_get_args();
            $result = parent::getPageLayout(...\array_values($arguments));
            return $this->____plugin_shopping_feed_editor_layout()->afterGetPageLayout($this, $result, ...\array_values($arguments));
        default:
            $arguments = \func_get_args();
            return parent::getPageLayout(...\array_values($arguments));
    }
}
PHP;
        if (!LayoutXmlOwnership::bodyMatches($method, $expected)) return null;
        $scope = LayoutXmlOwnership::configurationScope($merge);
        return $scope === null ? null : ($scope === 'adminhtml' ? 'plugin' : 'native');
    }

    private function complete($merge, array $params, $result, ?\Throwable $error, string $class): void
    {
        if (!$merge instanceof Merge) return;
        $index = array_key_last($this->reading);
        if ($index !== null && !$this->overflow && $class === Merge::class && !$error) {
            $this->reading[$index]['native'] = true;
            $this->reading[$index]['signature'] = self::signature($result);
        }
        $proof = $this->ownership->endProducer($merge, 'getPageLayout', $error);
        if (!$proof['final']) return;
        if ($this->overflow) { $this->overflow--; return; }
        $frame = array_pop($this->reading);
        if (!$frame || $frame['merge'] !== $merge) {
            $this->errors['Unbalanced page-layout getter hook evidence'] = true;
            return;
        }
        if ($error) return;
        $compiled = self::compiledPath($merge);
        $pluginPath = $compiled === 'plugin' || $frame['afterOnly'];
        $expectedPlugin = $frame['lookup'];
        if ($compiled === 'plugin' && (new \ReflectionObject($merge))->hasProperty('____plugin_' . self::NAME)) {
            $expectedPlugin = (new \ReflectionProperty($merge, '____plugin_' . self::NAME))->getValue($merge);
        }
        if ($frame['afterOnly'] && $frame['lookup'] === null) $this->errors['Missing native page-layout plugin lookup hook evidence'] = true;
        $nativePlugin = is_object($expectedPlugin) && get_class($expectedPlugin) === self::PLUGIN;
        if ($pluginPath && $nativePlugin && !$frame['pluginObserved']) $this->errors['Missing native page-layout after-plugin hook evidence'] = true;
        if ($pluginPath && $nativePlugin && $frame['pluginObserved'] && !$frame['conditionObserved']) {
            $this->errors['Missing native page-layout plugin condition hook evidence'] = true;
        }
        if (($compiled !== null || $proof['trusted'] || $pluginPath) && !$frame['native']) {
            $this->errors['Missing native page-layout getter hook evidence'] = true;
        }
        $knownPlugin = $pluginPath && $nativePlugin && $expectedPlugin === $frame['plugin']
            && $frame['pluginObserved'] && $frame['conditionObserved'] && $frame['passThrough']
            && $frame['matchingInput'] && $frame['matchingOutput'];
        $trusted = $frame['native'] && $frame['signature'] !== null
            && self::signature($result) === $frame['signature']
            && ($proof['trusted'] || $compiled === 'native' || $knownPlugin);
        ($this->consume)($merge, $result, $trusted, $frame['signature']);
    }

    public function finish(): void
    {
        if ($this->reading || $this->overflow) $this->errors['Unbalanced page-layout getter hook evidence'] = true;
        if ($this->nativeBodies !== $this->observedBodies) $this->errors['Missing native page-layout getter hook evidence'] = true;
        if ($this->errors) throw new \RuntimeException(implode(', ', array_keys($this->errors)));
    }
}
