<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\Data\Argument\InterpreterInterface;
use Magento\Framework\Data\Argument\Interpreter;
use Magento\Framework\View\Layout\Argument\Interpreter as LayoutInterpreter;
use Magento\Framework\View\Layout\Reader\Block as BlockReader;
use Magento\Framework\View\Layout\Generator\Block as BlockGenerator;

/** Attribute values only across an observed native interpreter chain. */
final class LayoutArgumentOwnership
{
    private const NATIVE = [
        Interpreter\Composite::class, Interpreter\ArrayType::class, Interpreter\Boolean::class,
        Interpreter\Number::class, Interpreter\StringUtils::class, Interpreter\BaseStringUtils::class, Interpreter\NullType::class,
        Interpreter\Constant::class,
        InterpreterInterface\Proxy::class,
        LayoutInterpreter\Decorator\Updater::class, LayoutInterpreter\DataObject::class,
        LayoutInterpreter\Options::class, LayoutInterpreter\Passthrough::class,
        LayoutInterpreter\Url::class, LayoutInterpreter\HelperMethod::class, LayoutInterpreter\NamedParams::class,
        'Magento\\Framework\\View\\Element\\UiComponent\\Argument\\Interpreter\\ConfigurableObject',
        'Magento\\Store\\Model\\Argument\\Interpreter\\ServiceUrl',
    ];
    private array $batches = [];
    private array $evaluating = [];
    private array $errors = [];
    private int $batchOverflow = 0;
    private int $evaluationOverflow = 0;

    public function __construct(private readonly \Closure $fingerprint, private readonly \Closure $matches)
    {
    }

    public function hooks(): array
    {
        return [[InterpreterInterface::class, 'evaluate', $this->begin(...), $this->end(...)]];
    }

    public function finish(): void
    {
        if ($this->batches || $this->evaluating || $this->batchOverflow || $this->evaluationOverflow) {
            $this->errors['Unbalanced layout argument interpreter hook evidence'] = true;
        }
        if ($this->errors) throw new \RuntimeException(implode(', ', array_keys($this->errors)));
    }

    public function beginBatch(object $owner, bool $reader, array $arguments = []): void
    {
        if ($this->batchOverflow || count($this->batches) >= 256) {
            $this->batchOverflow++;
            $this->errors['Layout argument batch nesting exceeded 256 calls'] = true;
            return;
        }
        $this->batches[] = ['owner' => $owner, 'reader' => $reader, 'queue' => [], 'next' => 0,
            'unconfirmed' => [], 'depth' => count($this->evaluating)];
        if (!$reader) $this->supply($arguments);
    }

    public function supply(array $arguments, ?object $reader = null): void
    {
        $index = array_key_last($this->batches);
        if ($this->batchOverflow) return;
        if ($reader !== null && ($index === null || !$this->batches[$index]['reader'] || $this->batches[$index]['owner'] !== $reader)) {
            $this->errors['Missing native layout reader argument batch hook evidence'] = true;
            return;
        }
        if ($index === null) return;
        if (count($arguments) > 1024) {
            $this->errors['Layout argument batch exceeded 1024 values'] = true;
            return;
        }
        $reader = $this->batches[$index]['reader'];
        $queue = [];
        foreach ($arguments as $name => $data) {
            if ($reader ? isset($data['updater']) : !isset($data['xsi:type'])) continue;
            $queue[] = ['name' => $name, 'input' => ($this->fingerprint)($data)];
        }
        $this->batches[$index]['queue'] = $queue;
    }

    public function endBatch(?\Throwable $error): array
    {
        if ($this->batchOverflow) {
            $this->batchOverflow--;
            return [];
        }
        $batch = array_pop($this->batches);
        if (!$batch) {
            $this->errors['Unbalanced layout argument batch hook evidence'] = true;
            return [];
        }
        if (!$error && ($batch['next'] !== count($batch['queue']) || $batch['depth'] !== count($this->evaluating))) {
            $this->errors['Missing native layout argument interpreter hook evidence'] = true;
        }
        return array_keys($batch['unconfirmed']);
    }

    private static function native(object $interpreter): bool
    {
        $owner = (new \ReflectionMethod($interpreter, 'evaluate'))->getDeclaringClass()->getName();
        $class = get_class($interpreter);
        if (in_array($class, self::NATIVE, true)) return in_array($owner, self::NATIVE, true);
        $parent = get_parent_class($interpreter);
        if ($class !== $parent . '\\Interceptor' || !in_array($parent, self::NATIVE, true) || $owner !== $parent) return false;
        $file = (new \ReflectionClass($interpreter))->getFileName();
        return is_string($file) && str_starts_with($file, BP . '/generated/code/');
    }

    private function begin($interpreter, array $params): void
    {
        if (!$this->batches || $this->batchOverflow) return;
        if ($this->evaluationOverflow || count($this->evaluating) >= 256) {
            $this->evaluationOverflow++;
            $this->errors['Layout interpreter nesting exceeded 256 calls'] = true;
            return;
        }
        $index = array_key_last($this->batches);
        $batch = $this->batches[$index];
        $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? [];
        $native = $batch['reader'] ? BlockReader::class : BlockGenerator::class;
        $root = ($caller['class'] ?? null) === $native && ($caller['function'] ?? null) === 'evaluateArguments';
        $name = null;
        if ($root) {
            $expected = $batch['queue'][$batch['next']] ?? null;
            $this->batches[$index]['next']++;
            if ($expected === null) {
                $this->errors['Unexpected native layout argument interpreter call'] = true;
            } else {
                $name = $expected['name'];
                if ($expected['input'] === null || !($this->matches)($expected['input'], $params[0])) {
                    $this->batches[$index]['unconfirmed'][$name] = true;
                }
            }
        } else {
            $parent = $this->evaluating[array_key_last($this->evaluating)] ?? null;
            if ($parent !== null && $parent['batch'] === $index && ($caller['function'] ?? null) === 'evaluate'
                && is_a($caller['class'] ?? '', InterpreterInterface::class, true)) $name = $parent['name'];
        }
        if ($name !== null && !self::native($interpreter)) $this->batches[$index]['unconfirmed'][$name] = true;
        $this->evaluating[] = ['batch' => $index, 'name' => $name];
    }

    private function end(): void
    {
        if (!$this->batches || $this->batchOverflow) return;
        if ($this->evaluationOverflow) {
            $this->evaluationOverflow--;
            return;
        }
        array_pop($this->evaluating);
    }
}
