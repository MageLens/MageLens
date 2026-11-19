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

    public function __construct(private readonly \Closure $fingerprint, private readonly \Closure $matches,
        private readonly ?\Closure $emit = null)
    {
    }

    public function hooks(): array
    {
        return [[InterpreterInterface::class, 'evaluate', $this->begin(...), $this->end(...)],
            [Interpreter\Composite::class, 'getInterpreter', $this->beginTypeLookup(...), $this->selectedType(...)]];
    }

    public function finish(): void
    {
        if ($this->batches || $this->evaluating || $this->batchOverflow || $this->evaluationOverflow) {
            $this->errors['Unbalanced layout argument interpreter hook evidence'] = true;
        }
        if ($this->errors) throw new \RuntimeException(implode(', ', array_keys($this->errors)));
    }

    public function beginBatch(object $owner, bool $reader, array $arguments = [], array $origins = [], ?array $context = null): void
    {
        if ($this->batchOverflow || count($this->batches) >= 256) {
            $this->batchOverflow++;
            $this->errors['Layout argument batch nesting exceeded 256 calls'] = true;
            return;
        }
        $this->batches[] = ['owner' => $owner, 'reader' => $reader, 'queue' => [], 'next' => 0,
            'unconfirmed' => [], 'completed' => [], 'typeAttempts' => [], 'typeObserved' => [], 'context' => $context, 'depth' => count($this->evaluating)];
        if (!$reader) $this->supply($arguments, null, $origins);
    }

    public function supply(array $arguments, ?object $reader = null, array $origins = [], ?array $context = null): void
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
            // A reader can already have returned an object. Do not perform an
            // application ArrayAccess probe or duplicate the generator's error.
            if (!is_array($data)) continue;
            if ($reader ? isset($data['updater']) : !isset($data['xsi:type'])) continue;
            $queue[] = ['name' => $name, 'input' => ($this->fingerprint)($data),
                'type' => $origins[$name]['type'] ?? $origins[$name]['pending']['type'] ?? null];
        }
        $this->batches[$index]['queue'] = $queue;
        if ($context !== null) $this->batches[$index]['context'] = $context;
    }

    public function endBatch(?\Throwable $error, ?array &$completed = null): array
    {
        $completed = [];
        if ($this->batchOverflow) {
            $this->batchOverflow--;
            return [];
        }
        $batch = array_pop($this->batches);
        if (!$batch) {
            $this->errors['Unbalanced layout argument batch hook evidence'] = true;
            return [];
        }
        if ((!$error && $batch['next'] !== count($batch['queue'])) || $batch['depth'] !== count($this->evaluating)) {
            $this->errors['Missing native layout argument interpreter hook evidence'] = true;
        }
        if ($this->emit !== null && ($batch['context'] ?? null) !== null) {
            foreach (array_diff_key($batch['typeAttempts'] ?? [], $batch['typeObserved'] ?? []) as $id => $_) {
                ($this->emit)($id, 'layout-argument-type-origin-unconfirmed', $batch['context']);
            }
        }
        $completed = array_keys(array_diff_key($batch['completed'], $batch['unconfirmed']));
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
        $caller = LayoutRuntimeHooks::trace(DEBUG_BACKTRACE_IGNORE_ARGS | DEBUG_BACKTRACE_PROVIDE_OBJECT, 3)[2] ?? [];
        $native = $batch['reader'] ? BlockReader::class : BlockGenerator::class;
        $root = ($caller['class'] ?? null) === $native && ($caller['function'] ?? null) === 'evaluateArguments';
        $name = null;
        $type = null;
        $input = null;
        if ($root) {
            $expected = $batch['queue'][$batch['next']] ?? null;
            $this->batches[$index]['next']++;
            if ($expected === null) {
                $this->errors['Unexpected native layout argument interpreter call'] = true;
            } else {
                $name = $expected['name'];
                $input = $expected['input'];
                $type = $expected['type'];
                if ($expected['input'] === null || !($this->matches)($expected['input'], $params[0])) {
                    $this->batches[$index]['unconfirmed'][$name] = true;
                    $type = null;
                }
            }
        } else {
            $parent = $this->evaluating[array_key_last($this->evaluating)] ?? null;
            if ($parent !== null && $parent['batch'] === $index && ($caller['function'] ?? null) === 'evaluate'
                && is_a($caller['class'] ?? '', InterpreterInterface::class, true)) {
                $name = $parent['name'];
                if (($caller['object'] ?? null) === $parent['object'] && self::native($parent['object'])
                    && (($parent['input'] !== null && ($this->matches)($parent['input'], $params[0]))
                    || ($parent['forwarded'] !== null && ($this->matches)($parent['forwarded'], $params[0])))) {
                    $type = $parent['type']; $input = ($this->fingerprint)($params[0]);
                }
            }
        }
        if ($root && isset($type['id'])) $this->batches[$index]['typeAttempts'][$type['id']] = true;
        if ($name !== null && !self::native($interpreter)) $this->batches[$index]['unconfirmed'][$name] = true;
        $expected = $this->typeInput($interpreter, $type, $params[0]['xsi:type'] ?? null);
        $forwarded = null;
        if ($type !== null && $interpreter instanceof LayoutInterpreter\Decorator\Updater
            && LayoutXmlOwnership::nativeMethod($interpreter, LayoutInterpreter\Decorator\Updater::class, 'evaluate')) {
            $data = $params[0];
            unset($data['updater']);
            $forwarded = ($this->fingerprint)($data);
        }
        $this->evaluating[] = ['batch' => $index, 'name' => $name, 'root' => $root,
            'object' => $interpreter, 'type' => $type, 'input' => $input, 'forwarded' => $forwarded, 'expectedType' => $expected,
            'lookupEntered' => false, 'lookup' => false, 'trustedLookup' => false, 'deferred' => false];
    }

    private function typeInput(object $composite, ?array $type, $value): bool
    {
        if (!isset($type['value']) || !$composite instanceof Interpreter\Composite
            || !LayoutXmlOwnership::nativeMethod($composite, Interpreter\Composite::class, 'evaluate')
            || (new \ReflectionClass($composite))->isUninitializedLazyObject($composite)) return false;
        $property = new \ReflectionProperty(Interpreter\Composite::class, 'discriminator');
        return !$property->getHooks() && $property->isInitialized($composite)
            && $property->getRawValue($composite) === 'xsi:type' && ($this->matches)($type['value'], $value);
    }

    private static function nativeTypeLookup(object $composite): bool
    {
        $caller = LayoutXmlOwnership::caller($composite, 'getInterpreter');
        return ($caller['class'] ?? null) === Interpreter\Composite::class
            && ($caller['function'] ?? null) === 'evaluate' && ($caller['object'] ?? null) === $composite;
    }

    private function beginTypeLookup($composite, array $params): void
    {
        if ($this->evaluationOverflow) return;
        $index = array_key_last($this->evaluating);
        if ($index === null || !is_array($this->evaluating[$index]) || $this->evaluating[$index]['object'] !== $composite
            || $this->evaluating[$index]['type'] === null || !self::nativeTypeLookup($composite)) return;
        $this->evaluating[$index]['lookupEntered'] = true;
        // A lazy Composite initializes at its own discriminator read. Observe
        // the subsequent native lookup rather than initializing it ourselves.
        $this->evaluating[$index]['expectedType'] = $this->typeInput(
            $composite, $this->evaluating[$index]['type'], $params[0] ?? null);
    }

    private function selectedType($composite, array $params, $result, ?\Throwable $error): void
    {
        if ($this->evaluationOverflow) return;
        $index = array_key_last($this->evaluating);
        if ($index === null || !is_array($this->evaluating[$index]) || $this->evaluating[$index]['object'] !== $composite
            || $this->evaluating[$index]['type'] === null || !self::nativeTypeLookup($composite)) return;
        $frame = $this->evaluating[$index];
        $this->evaluating[$index]['lookup'] = true;
        $this->evaluating[$index]['trustedLookup'] = $frame['expectedType'] && !$error
            && $result instanceof InterpreterInterface
            && LayoutXmlOwnership::nativeMethod($composite, Interpreter\Composite::class, 'getInterpreter')
            && ($this->matches)($frame['type']['value'], $params[0] ?? null);
        $this->evaluating[$index]['deferred'] = $result instanceof LayoutInterpreter\Passthrough;
    }

    private function end($interpreter, array $params, $result, ?\Throwable $error): void
    {
        if (!$this->batches || $this->batchOverflow) return;
        if ($this->evaluationOverflow) {
            $this->evaluationOverflow--;
            return;
        }
        $frame = array_pop($this->evaluating);
        if ($frame === null) {
            $this->errors['Missing native layout argument interpreter entry hook evidence'] = true;
            return;
        }
        if ($frame['type'] !== null && $interpreter instanceof Interpreter\Composite) {
            if ((!$error || $frame['lookupEntered'] || $frame['lookup'])
                && LayoutXmlOwnership::nativeMethod($interpreter, Interpreter\Composite::class, 'evaluate')
                && LayoutXmlOwnership::nativeMethod($interpreter, Interpreter\Composite::class, 'getInterpreter')
                && (!$frame['lookupEntered'] || !$frame['lookup'])) {
                $this->errors['Missing native layout argument type dispatch hook evidence'] = true;
            }
            $context = $this->batches[$frame['batch']]['context'] ?? null;
            if ($this->emit !== null && $context !== null) {
                $this->batches[$frame['batch']]['typeObserved'][$frame['type']['id']] = true;
                $effect = !$frame['expectedType'] ? 'layout-argument-type-origin-unconfirmed'
                    : ($error ? 'layout-argument-type-failed' : (!$frame['trustedLookup']
                    ? 'layout-argument-type-origin-unconfirmed' : ($frame['deferred']
                        ? 'layout-argument-type-deferred' : 'layout-argument-type-evaluated')));
                ($this->emit)($frame['type']['id'], $effect, $context);
            }
        }
        if (!$error && $frame['root'] && $frame['name'] !== null && isset($this->batches[$frame['batch']])) {
            $this->batches[$frame['batch']]['completed'][$frame['name']] = true;
        }
    }
}
