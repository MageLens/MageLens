<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\App\Config\ScopeConfigInterface;
use Magento\Framework\App\ScopeResolverInterface;
use Magento\Framework\View\Layout\Generator\Block;
use Magento\Framework\View\Layout\ScheduledStructure;

/** Attribute guard decisions to native scheduled actions, separately from calls. */
final class LayoutActionGuards
{
    private array $processing = [];
    private array $snapshots = [];
    private array $lookups = [];
    private array $flags = [];
    private array $overflow = [];
    private array $errors = [];
    private bool $healthy = false;

    public function __construct(private readonly \Closure $emit)
    {
    }

    public function hooks(): array
    {
        return [
            [Block::class, 'process', $this->beginProcess(...), $this->endProcess(...)],
            [ScheduledStructure::class, 'getElements', $this->beginSnapshot(...), $this->endSnapshot(...)],
            [ScopeResolverInterface::class, 'getScope', $this->beginLookup(...), $this->endLookup(...)],
            [ScopeConfigInterface::class, 'isSetFlag', $this->beginFlag(...), $this->endFlag(...)],
        ];
    }

    public function finish(): bool
    {
        if ($this->processing || $this->snapshots || $this->lookups || $this->flags || array_filter($this->overflow)) {
            $this->errors['Unbalanced native action guard hook evidence'] = true;
        }
        if ($this->errors) throw new \RuntimeException(implode('; ', array_keys($this->errors)));
        return $this->healthy;
    }

    private function push(string $stack, array $frame): void
    {
        if (($this->overflow[$stack] ?? 0) || count($this->{$stack}) >= 256) {
            $this->overflow[$stack] = ($this->overflow[$stack] ?? 0) + 1;
            $this->errors['Layout action guard ' . $stack . ' nesting exceeded 256 calls'] = true;
        } else $this->{$stack}[] = $frame;
    }

    private function pop(string $stack): ?array
    {
        if ($this->overflow[$stack] ?? 0) { $this->overflow[$stack]--; return null; }
        $frame = array_pop($this->{$stack});
        if ($frame === null) $this->errors['Missing native action guard ' . $stack . ' entry evidence'] = true;
        return $frame;
    }

    private static function caller(string $method): ?object
    {
        $trace = LayoutRuntimeHooks::trace(DEBUG_BACKTRACE_IGNORE_ARGS | DEBUG_BACKTRACE_PROVIDE_OBJECT, 7);
        foreach ($trace as $index => $frame) {
            if ($frame['function'] !== $method) continue;
            $caller = $trace[$index + 1] ?? [];
            if (($caller['class'] ?? null) === Block::class && ($caller['function'] ?? null) === 'process') {
                return $caller['object'] ?? null;
            }
            return null;
        }
        return null;
    }

    private function index(object $generator): ?int
    {
        if (($this->overflow['processing'] ?? 0) || !LayoutXmlOwnership::nativeMethod($generator, Block::class, 'process')) return null;
        $index = array_key_last($this->processing);
        return $index !== null && $this->processing[$index]['generator'] === $generator ? $index : null;
    }

    private function beginProcess($generator, array $params, string $class): void
    {
        if ($class !== Block::class || !LayoutXmlOwnership::nativeMethod($generator, Block::class, 'process')) return;
        $this->push('processing', ['generator' => $generator, 'snapshot' => false, 'safe' => false,
            'actions' => [], 'counts' => [], 'candidates' => [], 'known' => [], 'seen' => [], 'pending' => false]);
    }

    private function endProcess($generator, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Block::class || !LayoutXmlOwnership::nativeMethod($generator, Block::class, 'process')) return;
        $frame = $this->pop('processing');
        if ($frame === null) return;
        if ($frame['generator'] !== $generator || $frame['pending']) $this->errors['Missing native action guard scope or flag hook evidence'] = true;
        foreach ($frame['known'] as $id => $context) {
            if (!isset($frame['seen'][$id])) $this->record($id, 'unobserved', $context);
        }
    }

    private function beginSnapshot($schedule, array $params, string $class): void
    {
        $generator = self::caller('getElements');
        if ($class !== ScheduledStructure::class || $generator === null || ($index = $this->index($generator)) === null) return;
        $safe = (new \ReflectionMethod($schedule, 'getElements'))->getDeclaringClass()->getName() === ScheduledStructure::class
            && LayoutXmlOwnership::unhookedProperty($schedule, 'scheduledElements') !== null;
        $this->push('snapshots', ['index' => $index, 'schedule' => $schedule, 'safe' => $safe]);
    }

    private function endSnapshot($schedule, array $params, $elements, ?\Throwable $error, string $class): void
    {
        $generator = self::caller('getElements');
        if ($class !== ScheduledStructure::class || $generator === null || $this->index($generator) === null) return;
        $frame = $this->pop('snapshots');
        if ($frame === null) return;
        $index = $frame['index'];
        $this->processing[$index]['snapshot'] = true;
        if ($error || $frame['schedule'] !== $schedule || !$frame['safe'] || !is_array($elements)) return;
        $actions = []; $counts = []; $total = 0;
        foreach ($elements as $name => $element) {
            if (!is_array($element)) return;
            if (($element[0] ?? null) !== Block::TYPE) continue;
            $entries = $element[1]['actions'] ?? [];
            if (!is_array($entries)) return;
            $signatures = [];
            foreach ($entries as $action) {
                if (++$total > 8192) { $this->errors['Layout action guard snapshot exceeded 8192 actions'] = true; return; }
                if (!is_array($action) || (!empty($action[2]) && !is_string($action[2])) || !is_string($action[3] ?? null)) return;
                $signatures[] = Xml::scalarTreeSignature($action);
                if (!empty($action[2])) {
                    $key = self::key($action[2], $action[3]);
                    $counts[$key] = ($counts[$key] ?? 0) + 1;
                }
            }
            if ($entries) $actions[$name] = $signatures;
        }
        $this->processing[$index]['safe'] = true;
        $this->processing[$index]['actions'] = $actions;
        $this->processing[$index]['counts'] = $counts;
    }

    public static function key(string $path, string $scope): string
    {
        return hash('sha256', serialize([$path, $scope]));
    }

    public function supplied(object $generator, object $schedule, string|int $name, array $origins, ?array $context): void
    {
        if ($context === null || ($this->overflow['processing'] ?? 0)) return;
        $guards = array_filter($origins, static fn($origin) => isset($origin['guard']['id']));
        if (!$guards) return;
        $index = $this->index($generator);
        if ($index === null && LayoutXmlOwnership::nativeMethod($generator, Block::class, 'process')) {
            $this->errors['Missing native action guard process hook evidence'] = true;
        }
        if ($index !== null && !$this->processing[$index]['snapshot']
            && (new \ReflectionMethod($schedule, 'getElements'))->getDeclaringClass()->getName() === ScheduledStructure::class) {
            $this->errors['Missing native action guard snapshot hook evidence'] = true;
        }
        $signatures = array_column($origins, 'guardSignature');
        $safe = $index !== null && $this->processing[$index]['safe'] && !in_array(null, $signatures, true)
            && ($this->processing[$index]['actions'][$name] ?? null) === $signatures;
        foreach ($guards as $origin) {
            $guard = $origin['guard'];
            if (!$safe || $guard['key'] === null) { $this->record($guard['id'], 'origin-unconfirmed', $context); continue; }
            $this->processing[$index]['known'][$guard['id']] = $context;
            if (!$guard['empty']) $this->processing[$index]['candidates'][$guard['key']][$guard['id']] = $context;
        }
    }

    public function revoked(array $origins, ?array $context): void
    {
        if ($context === null) return;
        foreach ($origins as $origin) {
            if (isset($origin['guard']['id'])) $this->record($origin['guard']['id'], 'origin-unconfirmed', $context);
        }
    }

    public function ignored(object $generator, array $origin, array $context, bool $unique): void
    {
        $guard = $origin['guard'] ?? null;
        if ($guard === null || !$guard['empty'] || ($index = $this->index($generator)) === null
            || !isset($this->processing[$index]['known'][$guard['id']])) return;
        $this->processing[$index]['seen'][$guard['id']] = true;
        $this->record($guard['id'], $unique ? 'empty-ignored' : 'ambiguous', $context);
    }

    private function beginLookup($resolver): void
    {
        $generator = self::caller('getScope');
        if ($generator === null || ($index = $this->index($generator)) === null) return;
        $this->push('lookups', ['index' => $index, 'object' => $resolver]);
    }

    private function endLookup($resolver, array $params, $result, ?\Throwable $error): void
    {
        $generator = self::caller('getScope');
        if ($generator === null || $this->index($generator) === null) return;
        $frame = $this->pop('lookups');
        if ($frame === null) return;
        if ($frame['object'] !== $resolver) $this->errors['Mismatched native action guard scope evidence'] = true;
        if (!$error) $this->processing[$frame['index']]['pending'] = true;
    }

    private function beginFlag($config, array $params): void
    {
        $generator = self::caller('isSetFlag');
        if ($generator === null || ($index = $this->index($generator)) === null) return;
        if (!$this->processing[$index]['pending']) $this->errors['Missing native action guard scope hook evidence'] = true;
        $this->processing[$index]['pending'] = false;
        $key = is_string($params[0] ?? null) && is_string($params[1] ?? null) ? self::key($params[0], $params[1]) : null;
        $this->push('flags', ['index' => $index, 'object' => $config, 'key' => $key]);
    }

    private function endFlag($config, array $params, $result, ?\Throwable $error): void
    {
        $generator = self::caller('isSetFlag');
        if ($generator === null || $this->index($generator) === null) return;
        $frame = $this->pop('flags');
        if ($frame === null) return;
        if ($frame['object'] !== $config) { $this->errors['Mismatched native action guard flag evidence'] = true; return; }
        $index = $frame['index']; $key = $frame['key'];
        $origins = $this->processing[$index]['candidates'][$key] ?? [];
        $effect = count($origins) === 1 && ($this->processing[$index]['counts'][$key] ?? 0) === 1
            ? ($error ? 'failed' : ($result ? 'allowed' : 'denied')) : 'ambiguous';
        foreach ($origins as $id => $context) {
            $this->processing[$index]['seen'][$id] = true;
            $this->record($id, $effect, $context);
        }
    }

    private function record(string $id, string $effect, array $context): void
    {
        $this->healthy = true;
        ($this->emit)($id, 'layout-action-condition-' . $effect, $context);
    }
}
