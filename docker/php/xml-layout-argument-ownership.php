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
            [Interpreter\Composite::class, 'getInterpreter', $this->beginTypeLookup(...), $this->selectedType(...)],
            [\Magento\Framework\ObjectManager\Helper\SortItems::class, 'sortItems', $this->beginItems(...), $this->sortedItems(...)]];
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
            'unconfirmed' => [], 'completed' => [], 'typeAttempts' => [], 'typeObserved' => [], 'modifierAttempts' => [], 'modifierObserved' => [], 'context' => $context, 'depth' => count($this->evaluating)];
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
                'type' => $origins[$name]['type'] ?? $origins[$name]['pending']['type'] ?? null,
                'children' => $origins[$name]['children'] ?? []];
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
        if ($this->emit !== null && $batch['context'] !== null) {
            foreach (array_diff_key($batch['modifierAttempts'], $batch['modifierObserved']) as $id => $_) {
                ($this->emit)($id, 'layout-argument-modifier-origin-unconfirmed', $batch['context']);
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
        $children = [];
        if ($root) {
            $expected = $batch['queue'][$batch['next']] ?? null;
            $this->batches[$index]['next']++;
            if ($expected === null) {
                $this->errors['Unexpected native layout argument interpreter call'] = true;
            } else {
                $name = $expected['name'];
                $input = $expected['input'];
                $type = $expected['type'];
                $children = $expected['children'];
                if ($expected['input'] === null || !($this->matches)($expected['input'], $params[0])) {
                    $this->batches[$index]['unconfirmed'][$name] = true;
                    $type = null; $children = [];
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
                    $children = $parent['children'];
                } elseif (($caller['object'] ?? null) === $parent['object']
                    && $parent['object'] instanceof Interpreter\ArrayType && self::native($parent['object'])
                    && $parent['items']) {
                    $position = $parent['itemNext'];
                    $this->evaluating[array_key_last($this->evaluating)]['itemNext']++;
                    $item = $parent['items'][$position] ?? null;
                    if ($item === null) $this->errors['Unexpected native layout array item interpreter call'] = true;
                    elseif ($item['input'] !== null && ($this->matches)($item['input'], $params[0])) {
                        $type = $item['origin']['type'] ?? $item['origin']['pending']['type'] ?? null;
                        $children = $item['origin']['children'] ?? [];
                        $input = $item['input'];
                    }
                }
            }
        }
        if ($root && isset($type['id'])) $this->batches[$index]['typeAttempts'][$type['id']] = true;
        if ($name !== null && !self::native($interpreter)) $this->batches[$index]['unconfirmed'][$name] = true;
        $modifierInputs = [];
        foreach ($type['fields'] ?? [] as $attribute => $field) {
            $this->batches[$index]['modifierAttempts'][$field['id']] = true;
            $modifierInputs[$attribute] = array_key_exists($attribute, $params[0])
                && ($this->matches)($field['value'], $params[0][$attribute]);
        }
        $expected = $this->typeInput($interpreter, $type, $params[0]['xsi:type'] ?? null);
        $forwarded = null;
        if ($type !== null && $interpreter instanceof LayoutInterpreter\Decorator\Updater
            && LayoutXmlOwnership::nativeMethod($interpreter, LayoutInterpreter\Decorator\Updater::class, 'evaluate')) {
            $data = $params[0];
            unset($data['updater']);
            $forwarded = ($this->fingerprint)($data);
        }
        $dispatchInput = null;
        if (($type !== null || $children) && $interpreter instanceof Interpreter\Composite) {
            $data = $params[0]; unset($data['xsi:type']);
            $dispatchInput = ($this->fingerprint)($data);
        }
        $this->evaluating[] = ['batch' => $index, 'name' => $name, 'root' => $root,
            'object' => $interpreter, 'type' => $type, 'children' => $children, 'modifierInputs' => $modifierInputs,
            'itemsEntered' => false, 'itemsObserved' => false, 'sorter' => null, 'sortInputConfirmed' => false,
            'items' => [], 'itemNext' => 0,
            'itemInput' => $interpreter instanceof Interpreter\ArrayType ? ($this->fingerprint)($params[0]['item'] ?? []) : null,
            'input' => $input, 'forwarded' => $forwarded, 'expectedType' => $expected,
            'dispatchInput' => $dispatchInput, 'dispatchType' => ($this->fingerprint)($params[0]['xsi:type'] ?? null),
            'lookupEntered' => false, 'lookup' => false, 'trustedLookup' => false, 'deferred' => false];
    }

    private function itemFrame(): ?int
    {
        if ($this->evaluationOverflow) return null;
        $index = array_key_last($this->evaluating);
        $frame = $index === null ? null : $this->evaluating[$index];
        $caller = LayoutRuntimeHooks::trace(DEBUG_BACKTRACE_IGNORE_ARGS | DEBUG_BACKTRACE_PROVIDE_OBJECT, 4)[3] ?? [];
        return is_array($frame) && $frame['object'] instanceof Interpreter\ArrayType
            && ($caller['class'] ?? null) === Interpreter\ArrayType::class
            && ($caller['function'] ?? null) === 'evaluate' && ($caller['object'] ?? null) === $frame['object']
            && self::native($frame['object']) ? $index : null;
    }

    private function beginItems($sorter, array $params): void
    {
        $index = $this->itemFrame();
        if ($index === null) return;
        $frame = $this->evaluating[$index];
        $this->evaluating[$index]['itemsEntered'] = true;
        $this->evaluating[$index]['sorter'] = $sorter;
        $this->evaluating[$index]['sortInputConfirmed'] = $frame['itemInput'] !== null
            && ($this->matches)($frame['itemInput'], $params[0] ?? null)
            && LayoutXmlOwnership::nativeMethod($sorter, \Magento\Framework\ObjectManager\Helper\SortItems::class, 'sortItems');
    }

    private function sortedItems($sorter, array $params, $result, ?\Throwable $error): void
    {
        $index = $this->itemFrame();
        if ($index === null) return;
        $this->evaluating[$index]['itemsObserved'] = true;
        $frame = $this->evaluating[$index];
        if ($error || !is_array($result) || !$frame['children']) return;
        if (!$frame['sortInputConfirmed'] || $frame['sorter'] !== $sorter) {
            if ($frame['name'] !== null) $this->batches[$frame['batch']]['unconfirmed'][$frame['name']] = true;
            $this->unconfirmedTypes($frame['children'], $this->batches[$frame['batch']]['context']);
            return;
        }
        if (count($result) > 1024) {
            $this->errors['Layout argument array exceeded 1024 items'] = true;
            return;
        }
        // Preserve native sorted keys. Equal values do not choose an origin.
        foreach ($result as $key => $data) {
            $this->evaluating[$index]['items'][] = ['input' => ($this->fingerprint)($data),
                'origin' => $frame['children'][$key] ?? []];
        }
    }

    private function unconfirmedTypes(array $children, ?array $context): void
    {
        if ($this->emit === null || $context === null) return;
        $pending = array_values($children);
        $count = 0;
        while ($pending) {
            if (++$count > 1024) {
                $this->errors['Layout argument type tree exceeded 1024 fields'] = true;
                return;
            }
            $origin = array_pop($pending);
            $type = $origin['type'] ?? $origin['pending']['type'] ?? null;
            if (isset($type['id'])) ($this->emit)($type['id'], 'layout-argument-type-origin-unconfirmed', $context);
            foreach ($type['fields'] ?? [] as $field) ($this->emit)($field['id'], 'layout-argument-modifier-origin-unconfirmed', $context);
            foreach ($origin['children'] ?? [] as $child) $pending[] = $child;
        }
    }

    private static function modifierConsumer(string $attribute): string
    {
        return ['translate' => Interpreter\StringUtils::class, 'shared' => LayoutInterpreter\DataObject::class,
            'model' => LayoutInterpreter\Options::class, 'helper' => LayoutInterpreter\HelperMethod::class,
            'path' => LayoutInterpreter\Url::class][$attribute];
    }

    private function modifiers(array $frame, object $interpreter, ?\Throwable $error): void
    {
        $context = $this->batches[$frame['batch']]['context'] ?? null;
        if ($this->emit === null || $context === null || !self::native($interpreter)) return;
        foreach ($frame['type']['fields'] ?? [] as $attribute => $field) {
            $deferred = $interpreter instanceof LayoutInterpreter\Passthrough;
            $consumer = self::modifierConsumer($attribute);
            $serviceUrl = $attribute === 'path' && $interpreter instanceof \Magento\Store\Model\Argument\Interpreter\ServiceUrl;
            if (!$deferred && !$interpreter instanceof $consumer && !$serviceUrl) continue;
            $effect = empty($frame['modifierInputs'][$attribute]) ? 'layout-argument-modifier-origin-unconfirmed'
                : ($error ? 'layout-argument-modifier-failed' : ($deferred
                    ? 'layout-argument-modifier-deferred' : 'layout-argument-modifier-evaluated'));
            $this->batches[$frame['batch']]['modifierObserved'][$field['id']] = true;
            ($this->emit)($field['id'], $effect, $context);
        }
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
            || ($this->evaluating[$index]['type'] === null && !$this->evaluating[$index]['children']) || !self::nativeTypeLookup($composite)) return;
        $this->evaluating[$index]['lookupEntered'] = true;
        // A lazy Composite initializes at its own discriminator read. Observe
        // the subsequent native lookup rather than initializing it ourselves.
        $this->evaluating[$index]['expectedType'] = $this->typeInput(
            $composite, $this->evaluating[$index]['type'] ?? ['value' => $this->evaluating[$index]['dispatchType']], $params[0] ?? null);
    }

    private function selectedType($composite, array $params, $result, ?\Throwable $error): void
    {
        if ($this->evaluationOverflow) return;
        $index = array_key_last($this->evaluating);
        if ($index === null || !is_array($this->evaluating[$index]) || $this->evaluating[$index]['object'] !== $composite
            || ($this->evaluating[$index]['type'] === null && !$this->evaluating[$index]['children']) || !self::nativeTypeLookup($composite)) return;
        $frame = $this->evaluating[$index];
        $this->evaluating[$index]['lookup'] = true;
        $this->evaluating[$index]['trustedLookup'] = $frame['expectedType'] && !$error
            && $result instanceof InterpreterInterface
            && LayoutXmlOwnership::nativeMethod($composite, Interpreter\Composite::class, 'getInterpreter')
            && ($this->matches)($frame['type']['value'] ?? $frame['dispatchType'], $params[0] ?? null);
        if ($this->evaluating[$index]['trustedLookup']) $this->evaluating[$index]['forwarded'] = $frame['dispatchInput'];
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
        $this->modifiers($frame, $interpreter, $error);
        if ($frame['children'] && $interpreter instanceof Interpreter\ArrayType && self::native($interpreter)) {
            $missing = (!$error || $frame['itemsEntered'] || $frame['itemsObserved'])
                && (!$frame['itemsEntered'] || !$frame['itemsObserved']);
            if ($missing || ($frame['items'] && !$error && $frame['itemNext'] !== count($frame['items']))) {
                $this->errors['Missing native layout array item traversal hook evidence'] = true;
            }
        }
        if (($frame['type'] !== null || $frame['children']) && $interpreter instanceof Interpreter\Composite) {
            if ((!$error || $frame['lookupEntered'] || $frame['lookup'])
                && LayoutXmlOwnership::nativeMethod($interpreter, Interpreter\Composite::class, 'evaluate')
                && LayoutXmlOwnership::nativeMethod($interpreter, Interpreter\Composite::class, 'getInterpreter')
                && (!$frame['lookupEntered'] || !$frame['lookup'])) {
                $this->errors['Missing native layout argument type dispatch hook evidence'] = true;
            }
            $context = $this->batches[$frame['batch']]['context'] ?? null;
            if ($frame['type'] !== null && $this->emit !== null && $context !== null) {
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
