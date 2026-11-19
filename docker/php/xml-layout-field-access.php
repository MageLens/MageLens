<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\DataObject;
use Magento\Framework\View\Element\AbstractBlock;
use Magento\Framework\View\Element\Template;

/** Equal values cannot identify unobserved protected-property writes. */
final class LayoutFieldAccess
{
    private array $classes = [];
    private array $files = [];
    private int $declared = 0;
    private bool $external = false;

    public function __construct(private readonly string $field = '_template',
        private readonly string $base = Template::class, private readonly string $description = 'Template') {}

    public function unconfirmed(AbstractBlock $block): bool
    {
        $declared = get_declared_classes();
        if (count($declared) !== $this->declared) {
            $this->declared = count($declared);
            foreach ($declared as $name) {
                if (isset($this->classes[$name]) || !is_subclass_of($name, $this->base)) continue;
                if (count($this->classes) >= 1024) throw new \RuntimeException($this->description . ' implementation inventory exceeded 1024 classes');
                $this->classes[$name] = false;
                $type = new \ReflectionClass($name);
                $methods = $type->getMethods();
                foreach ($type->getProperties() as $property) array_push($methods, ...array_values($property->getHooks()));
                foreach ($methods as $method) {
                    if (in_array($method->getDeclaringClass()->getName(), [Template::class, AbstractBlock::class, DataObject::class], true)) continue;
                    $accesses = $this->accesses($method);
                    if ($accesses === null) { $this->external = true; continue; }
                    foreach ($accesses as $access) {
                        if ($access['line'] < $method->getStartLine() || $access['line'] > $method->getEndLine()) continue;
                        if ($access['self']) $this->classes[$name] = true;
                        else $this->external = true;
                    }
                }
            }
        }
        $property = new \ReflectionProperty($block, $this->field);
        return $this->external || ($this->classes[get_class($block)] ?? false) || $property->isPublic() || $property->isPromoted();
    }

    private function accesses(\ReflectionMethod $method): ?array
    {
        $file = $method->getFileName();
        if (!is_string($file) || !is_file($file) || !is_readable($file) || realpath($file) !== $file || filesize($file) > 262144) return null;
        if (isset($this->files[$file])) return $this->files[$file]['accesses'];
        if (count($this->files) >= 1024) throw new \RuntimeException($this->description . ' implementation inventory exceeded 1024 files');
        $source = @file_get_contents($file);
        if (!is_string($source)) throw new \RuntimeException('Cannot inspect ' . $this->description . ' implementation source');
        $tokens = [];
        $line = 1;
        foreach (token_get_all($source) as $token) {
            $text = is_array($token) ? $token[1] : $token;
            if (is_array($token)) $line = $token[2];
            if (!is_array($token) || !in_array($token[0], [T_OPEN_TAG, T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)) {
                $tokens[] = ['id' => is_array($token) ? $token[0] : null, 'text' => $text, 'line' => $line];
            }
            $line += substr_count($text, "\n");
        }
        $accesses = [];
        foreach ($tokens as $index => $token) {
            // Reflection can replace protected storage without an accessor call.
            // A literal storage operand establishes capability, not an observed write.
            if ($token['id'] === T_CONSTANT_ENCAPSED_STRING
                && in_array($token['text'], ["'" . $this->field . "'", '"' . $this->field . '"'], true)) {
                if (count($accesses) >= 4096) throw new \RuntimeException($this->description . ' implementation inventory exceeded 4096 field accesses');
                $accesses[] = ['line' => $token['line'], 'self' => true];
            }
            if (!in_array($token['id'], [T_OBJECT_OPERATOR, T_NULLSAFE_OBJECT_OPERATOR], true)) continue;
            $property = $tokens[$index + 1] ?? [];
            if (($property['id'] ?? null) === T_STRING && ($property['text'] ?? null) !== $this->field) continue;
            $end = $index + 1;
            if (($property['text'] ?? null) === '{') {
                for ($depth = 1, $end++; $depth && $end < count($tokens); $end++) {
                    if ($tokens[$end]['text'] === '{') $depth++;
                    elseif ($tokens[$end]['text'] === '}') $depth--;
                }
                $end--;
            }
            if (($tokens[$end + 1]['text'] ?? null) === '(') continue;
            if (($property['id'] ?? null) !== T_STRING && ($property['id'] ?? null) !== T_VARIABLE
                && ($property['text'] ?? null) !== '{') continue;
            if (count($accesses) >= 4096) throw new \RuntimeException($this->description . ' implementation inventory exceeded 4096 field accesses');
            $accesses[] = ['line' => $token['line'], 'self' => ($tokens[$index - 1]['text'] ?? null) === '$this'];
        }
        $this->files[$file] = ['hash' => hash('sha256', $source), 'accesses' => $accesses];
        return $accesses;
    }

    public function finish(): void
    {
        foreach ($this->files as $file => $source) {
            if (!is_file($file) || !is_readable($file) || realpath($file) !== $file
                || @hash_file('sha256', $file) !== $source['hash']) {
                throw new \RuntimeException($this->description . ' implementation source changed during layout collection');
            }
        }
    }
}
