<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\View\Layout\Reader\Block;
use Magento\Framework\View\Layout\Reader\Visibility\Condition;

require_once __DIR__ . '/xml-layout-kind-config.php';

/** Group selection is separate from interpretation and application of its values. */
final class LayoutArgumentGroups
{
    private array $reading = [];
    private array $errors = [];
    private int $overflow = 0;

    public function __construct(private readonly \Closure $origin, private readonly \Closure $emit) {}

    public function hooks(): array
    {
        $hooks = [];
        foreach ([Block::class, Condition::class] as $class) {
            $hooks[] = [$class, 'getArguments', $this->begin(...), $this->end(...)];
            $hooks[] = [$class, 'parseArguments', null, $this->parsed(...)];
        }
        return $hooks;
    }

    private function begin($reader, array $params, string $class): void
    {
        if ($this->overflow || count($this->reading) >= 256) {
            $this->overflow++;
            $this->errors['Layout argument group nesting exceeded 256 calls'] = true;
            return;
        }
        $native = true;
        foreach (['getArguments', 'getElementsByType', 'parseArguments'] as $method) {
            $native = $native && LayoutXmlOwnership::nativeMethod($reader, $class, $method);
        }
        $this->reading[] = ['reader' => $reader, 'class' => $class, 'xml' => $params[0], 'native' => $native,
            'observed' => false, 'group' => null];
    }

    private function parsed($reader, array $params, $result, ?\Throwable $error): void
    {
        if ($this->overflow) return;
        $index = array_key_last($this->reading);
        $caller = LayoutXmlOwnership::caller($reader, 'parseArguments');
        if ($index === null || !is_array($this->reading[$index]) || $this->reading[$index]['reader'] !== $reader
            || ($caller['class'] ?? null) !== $this->reading[$index]['class'] || ($caller['function'] ?? null) !== 'getArguments'
            || ($caller['object'] ?? null) !== $reader) return;
        $this->reading[$index]['observed'] = true;
        if (!$error && is_array($result)) $this->reading[$index]['group'] = dom_import_simplexml($params[0]);
    }

    private function ignored(\SimpleXMLElement $group, array $context): void
    {
        $node = dom_import_simplexml($group);
        $children = $node->getElementsByTagName('*');
        if ($children->length > 32768) {
            $this->errors['Ignored argument group inventory exceeded 32768 nodes'] = true;
            return;
        }
        foreach ($children as $child) {
            [$ids] = ($this->origin)(simplexml_import_dom($child));
            foreach (LayoutDeclarationKinds::IGNORED_ARGUMENT_DESCENDANTS as $kind) {
                if (isset($ids[$kind])) ($this->emit)($ids[$kind], 'layout-argument-group-ignored', $context);
            }
        }
    }

    private function end($reader, array $params, $result, ?\Throwable $error): void
    {
        if ($this->overflow) { $this->overflow--; return; }
        $frame = array_pop($this->reading);
        if (!$frame || $frame['reader'] !== $reader) {
            $this->errors['Missing native argument group entry observation'] = true;
            return;
        }
        $first = true;
        $selected = false;
        foreach ($frame['xml']->arguments as $group) {
            [$ids, $context] = ($this->origin)($group);
            if ($first) {
                if ($frame['native'] && !$error && !$frame['observed']) {
                    $this->errors['Missing native argument group parser observation'] = true;
                }
                $selected = $frame['native'] && !$error && $frame['group'] !== null
                    && $frame['group']->isSameNode(dom_import_simplexml($group));
            }
            if (isset($ids['argument-group']) && $context !== null) {
                $effect = !$frame['native'] || (!$error && !$selected) ? 'layout-argument-group-origin-unconfirmed'
                    : ($error ? 'layout-argument-group-failed' : ($first
                        ? 'layout-argument-group-selected' : 'layout-argument-group-ignored'));
                ($this->emit)($ids['argument-group'], $effect, $context);
                if (!$first && $selected) $this->ignored($group, $context);
            }
            $first = false;
        }
    }

    public function finish(): void
    {
        if ($this->reading || $this->overflow) $this->errors['Unbalanced native argument group observations'] = true;
        if ($this->errors) throw new \RuntimeException(implode(', ', array_keys($this->errors)));
    }
}
