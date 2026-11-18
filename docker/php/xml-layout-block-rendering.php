<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\View\Element\AbstractBlock;
use Magento\Framework\View\Layout;
use Magento\Framework\View\Layout\Generator\Block;

/** Keep logical layout elements independent of a factory's reusable PHP object. */
final class LayoutBlockRendering
{
    private \WeakMap $origins;
    private \WeakMap $registrations;
    private array $rendering = [];
    private int $overflow = 0;
    private array $errors = [];
    private bool $shared = false;
    private bool $registrationUnconfirmed = false;
    private array $processing = [];
    private int $processOverflow = 0;

    public function __construct(private readonly LayoutXmlOwnership $ownership)
    {
        $this->origins = new \WeakMap();
        $this->registrations = new \WeakMap();
    }

    public function generated(AbstractBlock $block, string $name, ?string $id, array $context): void
    {
        $state = $this->origins[$block] ?? ['all' => []];
        if ($id === null) {
            unset($state['latest']);
            $this->origins[$block] = $state;
            return;
        }
        $key = hash('sha256', json_encode([$id, $context], JSON_THROW_ON_ERROR));
        if (count($state['all']) >= 128 && !isset($state['all'][$key])) {
            $this->errors['Shared block origins exceeded 128 declarations'] = true;
            return;
        }
        $origin = ['id' => $id, 'context' => $context];
        $state['all'][$key] = $origin;
        $state['latest'] = $origin + ['name' => $name];
        $this->origins[$block] = $state;
    }

    public function hooks(): array
    {
        return [[Layout::class, '__construct', $this->watchRegistration(...), null],
            [Layout::class, 'setBlock',
                function ($layout, array $params, string $class): void {
                    if ($class === Layout::class) $this->beginRegistration($layout, $params, $class);
                },
                function ($layout, array $params, $result, ?\Throwable $error, string $class): void {
                    if ($class === Layout::class) $this->registered($layout, $params, $result, $error, $class);
                }],
            [Block::class, 'process', $this->beginProcess(...), $this->completeProcess(...)],
            [Layout::class, '_renderBlock', $this->begin(...), $this->complete(...)]];
    }

    private function watchRegistration($layout): void
    {
        $this->ownership->watchProducer($layout, Layout::class, 'setBlock',
            $this->beginRegistration(...), $this->registered(...));
    }

    private function beginRegistration($layout, array $params, string $class): void
    {
        $caller = LayoutXmlOwnership::caller($layout, 'setBlock');
        $direct = LayoutXmlOwnership::caller($layout, 'setBlock', false);
        $consumer = ($caller['class'] ?? null) === Block::class && ($caller['function'] ?? null) === 'process';
        $delegated = ($direct['class'] ?? null) === get_class($layout) && ($direct['function'] ?? null) === 'setBlock';
        $this->ownership->beginProducer($layout, Layout::class, $class, 'setBlock', $consumer, $delegated);
    }

    private function beginProcess($generator, array $params, string $class): void
    {
        if ($class !== Block::class) return;
        if ($this->processOverflow || count($this->processing) >= 256) {
            $this->processOverflow++;
            $this->errors['Block registration nesting exceeded 256 calls'] = true;
            return;
        }
        $this->processing[] = ['generator' => $generator, 'pending' => []];
    }

    public function expectRegistration($generator, string $name): void
    {
        $caller = LayoutXmlOwnership::caller($generator, 'generateBlock', false);
        if (($caller['class'] ?? null) !== Block::class || ($caller['function'] ?? null) !== 'process') return;
        if ($this->processOverflow) return;
        $index = array_key_last($this->processing);
        if ($index === null || $this->processing[$index]['generator'] !== $generator) {
            $this->errors['Missing native block process hook evidence'] = true;
            return;
        }
        if (count($this->processing[$index]['pending']) >= 8192) {
            $this->errors['Pending block registrations exceeded 8192 elements'] = true;
            return;
        }
        $this->processing[$index]['pending'][$name] = true;
    }

    private function completeProcess($generator, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Block::class) return;
        if ($this->processOverflow) { $this->processOverflow--; return; }
        $frame = array_pop($this->processing);
        if (!$frame || $frame['generator'] !== $generator) {
            $this->errors['Unbalanced block registration hook evidence'] = true;
        } elseif (!$error && $frame['pending']) {
            $this->errors['Missing native layout block registration hook evidence'] = true;
        }
    }

    private static function blocks(Layout $layout): array
    {
        static $property;
        $property ??= new \ReflectionProperty(Layout::class, '_blocks');
        return $property->getValue($layout);
    }

    private static function compiledFallback(Layout $layout): bool
    {
        $class = Layout::class . '\\Interceptor';
        if (get_class($layout) !== $class || $layout instanceof \Magento\Framework\Interception\InterceptorInterface) return false;
        $method = new \ReflectionMethod($layout, 'setBlock');
        if ($method->getDeclaringClass()->getName() !== $class) return false;
        $file = $method->getFileName();
        if (!is_string($file) || !str_starts_with($file, BP . '/generated/code/')) return false;
        $expected = <<<'PHP'
{
    switch ($this->____scope->getCurrentScope()) {
        case 'graphql':
            $arguments = \func_get_args();
            $result = parent::setBlock(...\array_values($arguments));
            return $this->____plugin_add_block_cache_tags_to_query_cache()->afterSetBlock($this, $result, ...\array_values($arguments));
        default:
            $arguments = \func_get_args();
            return parent::setBlock(...\array_values($arguments));
    }
}
PHP;
        if (!LayoutXmlOwnership::bodyMatches($method, $expected)) return false;
        // The reviewed fallback has no intervening application call between
        // this native field read and parent::setBlock. Do not invoke the getter again.
        $scope = LayoutXmlOwnership::configurationScope($layout);
        return $scope !== null && $scope !== 'graphql';
    }

    private function registered($layout, array $params, $result, ?\Throwable $error, string $class): void
    {
        $proof = $this->ownership->endProducer($layout, 'setBlock', $error);
        if (!$proof['final'] || $error) return;
        [$name, $block] = $params;
        $entries = $this->registrations[$layout] ?? [];
        unset($entries[$name]);
        $caller = LayoutXmlOwnership::caller($layout, 'setBlock');
        $process = array_key_last($this->processing);
        if ($process !== null && ($caller['class'] ?? null) === Block::class
            && ($caller['function'] ?? null) === 'process'
            && ($caller['object'] ?? null) === $this->processing[$process]['generator']) {
            unset($this->processing[$process]['pending'][$name]);
        }
        $source = $block instanceof AbstractBlock ? ($this->origins[$block]['latest'] ?? null) : null;
        $trusted = $proof['trusted'] || self::compiledFallback($layout);
        if (!$trusted && $source !== null) {
            $this->registrationUnconfirmed = true;
            Recorder::layout($source['id'], 'layout-block-registration-origin-unconfirmed', $source['context']);
        }
        if ($trusted && $source !== null && $source['name'] === $name
            && ($caller['class'] ?? null) === Block::class && ($caller['function'] ?? null) === 'process'
            && (self::blocks($layout)[$name] ?? null) === $block) {
            if (count($entries) >= 8192) $this->errors['Layout block registrations exceeded 8192 elements'] = true;
            else $entries[$name] = $source + ['block' => \WeakReference::create($block)];
        }
        $this->registrations[$layout] = $entries;
    }

    private function begin($layout, array $params, string $class): void
    {
        if ($class !== Layout::class) return;
        if ($this->overflow || count($this->rendering) >= 256) {
            $this->overflow++;
            $this->errors['Layout block rendering nesting exceeded 256 calls'] = true;
            return;
        }
        $this->rendering[] = ['layout' => $layout, 'name' => $params[0]];
    }

    private function complete($layout, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Layout::class) return;
        if ($this->overflow) { $this->overflow--; return; }
        $frame = array_pop($this->rendering);
        if (!$frame || $frame['layout'] !== $layout || $frame['name'] !== $params[0]) {
            $this->errors['Unbalanced layout block rendering hook evidence'] = true;
        }
    }

    public function origin(AbstractBlock $block): ?array
    {
        $state = $this->origins[$block] ?? null;
        if ($state === null) return null;
        $caller = LayoutXmlOwnership::caller($block, 'toHtml');
        if (($caller['class'] ?? null) === Layout::class && ($caller['function'] ?? null) === '_renderBlock') {
            $frame = $this->rendering[array_key_last($this->rendering)] ?? null;
            if (!$frame || $frame['layout'] !== ($caller['object'] ?? null)) {
                $this->errors['Missing native layout block rendering hook evidence'] = true;
                return null;
            }
            $source = $this->registrations[$frame['layout']][$frame['name']] ?? null;
            if ($source !== null && $source['block']->get() === $block
                && (self::blocks($frame['layout'])[$frame['name']] ?? null) === $block) return $source;
            // A native element call without its registration must not become a direct call.
            return null;
        }
        if (count($state['all']) === 1) return $state['latest'] ?? null;
        if (!$state['all']) return null;
        $this->shared = true;
        foreach ($state['all'] as $source) {
            Recorder::layout($source['id'], 'layout-block-render-origin-unconfirmed', $source['context']);
        }
        return null;
    }

    public function finish(): array
    {
        if ($this->rendering || $this->overflow) $this->errors['Unbalanced layout block rendering hook evidence'] = true;
        if ($this->processing || $this->processOverflow) $this->errors['Unbalanced block registration hook evidence'] = true;
        if ($this->errors) throw new \RuntimeException(implode(', ', array_keys($this->errors)));
        return [...($this->shared ? ['layout-shared-block-origin'] : []),
            ...($this->registrationUnconfirmed ? ['layout-block-registration-origin'] : [])];
    }
}
