<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\Filesystem\File\Read;
use Magento\Framework\View\Element\AbstractBlock;
use Magento\Framework\View\Element\Template;
use Magento\Framework\View\Layout;
use Magento\Framework\View\Layout\Generator\Block as BlockGenerator;
use Magento\Framework\View\Layout\Reader\Block as BlockReader;
use Magento\Framework\View\Model\Layout\Merge;
use Magento\Framework\View\TemplateEngine\Php;

final class LayoutCoverage
{
    private array $packages = [];
    private array $entries = [];
    private array $handles = [];
    private \WeakMap $merges;
    private array $documents = [];
    private array $appending = [];
    private array $contexts = [];
    private \WeakMap $structures;
    private array $generating = [];
    private \WeakMap $blocks;
    private array $fetching = [];
    private bool $healthy = false;
    private bool $sourceTrace = false;
    private array $limitations = [];
    private array $errors = [];

    private function __construct(private readonly array $sources)
    {
        $this->merges = new \WeakMap();
        $this->structures = new \WeakMap();
        $this->blocks = new \WeakMap();
    }

    public static function register(array $sources): array
    {
        if (!$sources) return [null, []];
        $collector = new self($sources);
        return [$collector, $collector->hooks()];
    }

    public function finish(): array
    {
        if ($this->errors) throw new \RuntimeException(implode('; ', array_keys($this->errors)));
        return [$this->healthy, $this->sourceTrace, array_keys($this->limitations)];
    }

    private function hooks(): array
    {
        return [
            [Merge::class, '_loadFileLayoutUpdatesXml', $this->beginPackage(...), $this->completePackage(...)],
            [Read::class, 'readAll', null, $this->readFile(...)],
            [Merge::class, '_loadXmlString', null, $this->parseFile(...)],
            [Merge::class, '_fetchRecursiveUpdates', $this->beginEntry(...), $this->traverseEntry(...)],
            [Merge::class, '_merge', $this->beginHandle(...), $this->completeHandle(...)],
            [Merge::class, '_fetchDbLayoutUpdates', null, $this->completeDatabaseUpdate(...)],
            [Merge::class, 'addUpdate', $this->beginUpdate(...), $this->appendUpdate(...)],
            [Merge::class, 'asSimplexml', null, $this->mergeDocument(...)],
            [BlockReader::class, 'scheduleBlock', null, $this->scheduleBlock(...)],
            [BlockReader::class, 'scheduleReference', null, $this->scheduleReference(...)],
            [Layout::class, 'generateElements', $this->beginElements(...), $this->generateElements(...)],
            [Layout::class, 'createIsolatedReaderContext', $this->snapshotContext(...), $this->mirrorContext(...)],
            [BlockGenerator::class, 'generateBlock', $this->beginBlock(...), $this->completeBlock(...)],
            [Template::class, 'setTemplate', null, $this->assignTemplate(...)],
            [AbstractBlock::class, '_loadCache', null, $this->loadBlockHtml(...)],
            [AbstractBlock::class, 'toHtml', $this->beginRender(...), $this->completeRender(...)],
            [Template::class, 'fetchView', $this->beginTemplate(...), $this->completeTemplate(...)],
            [Php::class, 'render', null, $this->renderTemplate(...)],
        ];
    }

    private function beginPackage($merge, array $params, string $class): void
    {
        if ($class === Merge::class) $this->packages[] = ['merge' => $merge, 'files' => [], 'pending' => null];
    }

    private function readFile($reader, array $params, $bytes, ?\Throwable $error, string $class): void
    {
        if (!$this->packages || $error || $class !== Read::class || !is_string($bytes)) return;
        $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? [];
        if (($caller['class'] ?? null) !== Merge::class || ($caller['function'] ?? null) !== '_loadFileLayoutUpdatesXml') return;
        static $pathProperty;
        $pathProperty ??= new \ReflectionProperty(Read::class, 'path');
        $path = $pathProperty->getValue($reader);
        $relative = str_starts_with($path, BP . '/') ? substr($path, strlen(BP) + 1) : '';
        $source = $this->sources[$relative] ?? null;
        if ($source !== null && !hash_equals($source['hash'], hash('sha256', $bytes))) {
            $this->errors['Layout source changed after preparation'] = true;
            $source = null;
        }
        $index = array_key_last($this->packages);
        $this->packages[$index]['pending'] = ['path' => $path, 'source' => $source];
    }

    private function parseFile($merge, array $params, $xml, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->packages);
        if ($index === null || $this->packages[$index]['merge'] !== $merge || $class !== Merge::class) return;
        $pending = $this->packages[$index]['pending'];
        $this->packages[$index]['pending'] = null;
        if (!$pending || $error || !$xml instanceof Layout\Element) return;
        $this->packages[$index]['files'][] = [
            'handle' => basename($pending['path'], '.xml'),
            'hash' => hash('sha256', $xml->innerXml()),
            'targets' => $pending['source']['targets'] ?? [],
        ];
    }

    // Associate file reads with positions in the native package document.
    // A skipped or transformed package without matching entries has no origin.
    private function completePackage($merge, array $params, $xml, ?\Throwable $error, string $class): void
    {
        if ($class !== Merge::class) return;
        $package = array_pop($this->packages);
        if ($error || !$xml instanceof Layout\Element || !$package || count($xml->children()) !== count($package['files'])) return;
        $entries = [];
        foreach ($xml->children() as $entry) {
            $file = $package['files'][count($entries)];
            $digest = hash('sha256', $entry->innerXml());
            if ($entry->getAttribute('id') !== $file['handle'] || $digest !== $file['hash']) return;
            $entries[dom_import_simplexml($entry)->getNodePath()] = $file['targets'];
        }
        $state = $this->merges[$merge] ?? [];
        $state['package'] = ['root' => dom_import_simplexml($xml), 'entries' => $entries];
        $this->merges[$merge] = $state;
    }

    private function beginEntry($merge, array $params, string $class): void
    {
        if ($class !== Merge::class) return;
        $handle = array_key_last($this->handles);
        $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? [];
        if ($handle !== null && $this->handles[$handle]['merge'] === $merge
            && ($caller['class'] ?? null) === Merge::class && ($caller['function'] ?? null) === '_fetchPackageLayoutUpdates') {
            $this->handles[$handle]['found'] = true;
        }

        $entry = dom_import_simplexml($params[0]);
        $package = $this->merges[$merge]['package'] ?? null;
        $updates = [];
        if ($package && $entry->ownerDocument->documentElement->isSameNode($package['root'])) {
            $source = $package['entries'][$entry->getNodePath()] ?? [];
            foreach ($entry->getElementsByTagName('*') as $index => $node) {
                if (!$node->parentNode->isSameNode($entry) || strtolower($node->tagName) !== 'update'
                    || !$node->hasAttribute('handle')) continue;
                $name = $node->getAttribute('handle');
                $candidate = $source[$index + 1] ?? [];
                $id = $candidate['element'] ?? null;
                $updates[] = ['handle' => $name, 'id' => $name === $id ? ($candidate['ids']['include'] ?? null) : null];
            }
        }
        $this->entries[] = ['merge' => $merge, 'updates' => $updates, 'next' => 0];
    }

    private function beginHandle($merge, array $params, string $class): void
    {
        if ($class !== Merge::class) return;
        $source = null;
        $entry = array_key_last($this->entries);
        $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? [];
        if ($entry !== null && $this->entries[$entry]['merge'] === $merge
            && ($caller['class'] ?? null) === Merge::class && ($caller['function'] ?? null) === '_fetchRecursiveUpdates') {
            $index = $this->entries[$entry]['next']++;
            $candidate = $this->entries[$entry]['updates'][$index] ?? null;
            if ($candidate && $candidate['handle'] === $params[0]) $source = $candidate['id'];
        }
        static $allHandles, $processing;
        $allHandles ??= new \ReflectionProperty(Merge::class, 'allHandles');
        $processing ??= new \ReflectionProperty(Merge::class, 'handleProcessing');
        $state = $allHandles->getValue($merge)[$params[0]] ?? null;
        $effect = $state === null ? null : ($state === $processing->getValue($merge) ? 'cycle' : 'duplicate');
        $this->handles[] = ['merge' => $merge, 'id' => $source, 'effect' => $effect, 'found' => false];
    }

    private function completeDatabaseUpdate($merge, array $params, $result, ?\Throwable $error, string $class): void
    {
        $handle = array_key_last($this->handles);
        if (!$error && $result === true && $class === Merge::class && $handle !== null && $this->handles[$handle]['merge'] === $merge) {
            $this->handles[$handle]['found'] = true;
        }
    }

    private function completeHandle($merge, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Merge::class) return;
        $handle = array_pop($this->handles);
        if ($error || !$handle || $handle['id'] === null) return;
        $effect = $handle['effect'] ?? ($handle['found'] ? 'traversed' : 'missing');
        $theme = $merge->getTheme();
        $this->event($handle['id'], 'layout-include-' . $effect, ['area' => $theme->getArea(), 'theme' => $theme->getFullPath()]);
    }

    private function traverseEntry($merge, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Merge::class) return;
        array_pop($this->entries);
        if ($error || !isset($this->merges[$merge]['package'])) return;
        $state = $this->merges[$merge];
        $entry = dom_import_simplexml($params[0]);
        $package = $state['package'];
        if (!$entry->ownerDocument->documentElement->isSameNode($package['root'])) return;
        $targets = $package['entries'][$entry->getNodePath()] ?? [];
        $state['pending'] = ['hash' => hash('sha256', $params[0]->innerXml()), 'targets' => $targets];
        $this->merges[$merge] = $state;
    }

    private function beginUpdate($merge, array $params, string $class): void
    {
        if ($class === Merge::class) $this->appending[] = count(self::updates($merge));
    }

    private function appendUpdate($merge, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Merge::class) return;
        $count = array_pop($this->appending);
        if ($error || !isset($this->merges[$merge]['pending'])) return;
        $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? [];
        if (($caller['class'] ?? null) !== Merge::class || ($caller['function'] ?? null) !== '_fetchPackageLayoutUpdates') return;
        $state = $this->merges[$merge];
        $pending = $state['pending'];
        unset($state['pending']);
        $updates = self::updates($merge);
        $index = array_key_last($updates);
        if (count($updates) === $count + 1 && $updates[$index] === $params[0]
            && $pending['hash'] === hash('sha256', $params[0])) {
            $state['updates'][$index] = $pending;
        }
        $this->merges[$merge] = $state;
    }

    private static function updates($merge): array
    {
        static $property;
        $property ??= new \ReflectionProperty(Merge::class, 'updates');
        return $property->getValue($merge);
    }

    // Native append order and deduplication determine which source occupies
    // each position. Preserve space for database and programmatic fragments.
    private function mergeDocument($merge, array $params, $xml, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== Merge::class || !$xml instanceof Layout\Element) return;
        $sources = $this->merges[$merge]['updates'] ?? [];
        if (!$sources) return;
        $root = dom_import_simplexml($xml);
        $allNodes = $root->getElementsByTagName('*');
        $targets = [];
        $offset = 0;
        foreach (self::updates($merge) as $index => $part) {
            try {
                $document = Xml::document('<layout xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' . $part . '</layout>');
            } catch (\RuntimeException) {
                return;
            }
            if (isset($sources[$index]) && $sources[$index]['hash'] === hash('sha256', $part)) {
                foreach ($sources[$index]['targets'] as $ordinal => $declarations) {
                    $node = $allNodes->item($offset + $ordinal - 1);
                    if (!$node) return;
                    $identity = $node->getAttribute($node->tagName === 'update' ? 'handle' : 'name');
                    if ($node->tagName !== $declarations['instruction'] || $identity !== $declarations['element']) return;
                    $targets[$node->getNodePath()] = $declarations['ids'];
                }
            }
            $offset += $document->documentElement->getElementsByTagName('*')->length;
        }
        if ($offset !== $allNodes->length) return;
        $theme = $merge->getTheme();
        $this->documents[] = ['root' => $root, 'targets' => $targets,
            'context' => ['area' => $theme->getArea(), 'theme' => $theme->getFullPath()]];
    }

    private function scheduleBlock($reader, array $params, $result, ?\Throwable $error, string $class): void
    {
        if (!$error && $class === BlockReader::class) $this->schedule($params[0], $params[1], true);
    }

    private function scheduleReference($reader, array $params, $result, ?\Throwable $error, string $class): void
    {
        if (!$error && $class === BlockReader::class && !filter_var($params[1]->getAttribute('remove'), FILTER_VALIDATE_BOOLEAN)) {
            $this->schedule($params[0], $params[1], false);
        }
    }

    private function schedule($structure, $xml, bool $declaration): void
    {
        $name = $xml->getAttribute('name');
        if ($name === '') return;
        $state = $this->structures[$structure] ?? [];
        $block = $state[$name] ?? [];
        $node = dom_import_simplexml($xml);
        $origin = null;
        foreach ($this->documents as $document) {
            if (!$node->ownerDocument->documentElement->isSameNode($document['root'])) continue;
            $origin = $document['targets'][$node->getNodePath()] ?? [];
            $block['context'] = $document['context'];
            break;
        }
        if ($declaration) $block['block'] = $origin['block'] ?? null;
        $actual = $structure->getStructureElementData($name, [])['attributes']['template'] ?? null;
        if (isset($xml['template']) || ($declaration && $actual === '')) {
            $value = (string) $xml['template'];
            if ($value === $actual) {
                $new = $origin['template'] ?? null;
                if (!empty($block['template']) && $block['template'] !== $new) $block['overridden'][$block['template']] = true;
                $block['template'] = $new;
            }
        }
        $state[$name] = $block;
        $this->structures[$structure] = $state;
    }

    private static function readerContext($layout)
    {
        static $property;
        $property ??= new \ReflectionProperty(Layout::class, 'readerContext');
        return $property->getValue($layout);
    }

    private function beginElements($layout, array $params, string $class): void
    {
        if ($class !== Layout::class) return;
        $structure = self::readerContext($layout)?->getScheduledStructure();
        if ($structure !== null) unset($this->structures[$structure]);
    }

    private function generateElements($layout, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== Layout::class) return;
        $this->healthy = true;
        $xml = $layout->getNode();
        if (!$xml instanceof Layout\Element) return;
        $node = dom_import_simplexml($xml);
        foreach ($this->documents as $document) {
            if ($node->isSameNode($document['root']) && isset($this->structures[self::readerContext($layout)->getScheduledStructure()])) {
                $this->sourceTrace = true;
                return;
            }
        }
        $this->limitations['missing-layout-origins'] = true;
    }

    private function snapshotContext($layout, array $params, string $class): void
    {
        if ($class !== Layout::class) return;
        $source = self::readerContext($layout)->getScheduledStructure();
        $this->contexts[] = $this->structures[$source] ?? [];
    }

    private function mirrorContext($layout, array $params, $context, ?\Throwable $error, string $class): void
    {
        if ($class !== Layout::class) return;
        $state = array_pop($this->contexts);
        if (!$error && $state) $this->structures[$context->getScheduledStructure()] = $state;
    }

    private function beginBlock($generator, array $params, string $class): void
    {
        if ($class !== BlockGenerator::class) return;
        $this->generating[] = ['source' => $this->structures[$params[0]][$params[2]] ?? [], 'selected' => null];
    }

    private function completeBlock($generator, array $params, $block, ?\Throwable $error, string $class): void
    {
        if ($class !== BlockGenerator::class) return;
        $frame = array_pop($this->generating);
        if ($error || !$block instanceof AbstractBlock || empty($frame['source']['context'])) return;
        $source = $frame['source'];
        $context = $source['context'];
        $blockId = $source['block'] ?? null;
        $templateId = $frame['selected'] === $block ? ($source['template'] ?? null) : null;
        foreach (array_keys($source['overridden'] ?? []) as $previous) {
            if ($previous !== $templateId) $this->event($previous, 'layout-template-overridden', $context);
        }
        $this->event($blockId, 'layout-block-created', $context);
        $this->event($templateId, 'layout-template-selected', $context);
        $this->blocks[$block] = ['block' => $blockId, 'template' => $templateId, 'context' => $context];
    }

    private function assignTemplate($block, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error) return;
        $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? [];
        $generation = array_key_last($this->generating);
        if ($generation !== null && $class === Template::class && ($caller['class'] ?? null) === BlockGenerator::class
            && ($caller['function'] ?? null) === 'generateBlock') {
            $this->generating[$generation]['selected'] = $block;
        }
        if (isset($this->blocks[$block]['template'])) {
            $evidence = $this->blocks[$block];
            $this->event($evidence['template'], 'layout-template-replaced', $evidence['context']);
            $evidence['template'] = null;
            $this->blocks[$block] = $evidence;
        }
    }

    private function beginRender($block, array $params, string $class): void
    {
        if (isset($this->blocks[$block])) {
            $state = $this->blocks[$block];
            unset($state['executed'], $state['html']);
            $this->blocks[$block] = $state;
        }
    }

    private function loadBlockHtml($block, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || !isset($this->blocks[$block])) return;
        $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? [];
        if (($caller['class'] ?? null) === AbstractBlock::class && ($caller['function'] ?? null) === 'toHtml') {
            $state = $this->blocks[$block];
            $state['html'] = true;
            $this->blocks[$block] = $state;
        }
    }

    private function completeRender($block, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || !isset($this->blocks[$block])) return;
        $evidence = $this->blocks[$block];
        if (!empty($evidence['html'])) $this->event($evidence['block'], 'layout-block-rendered', $evidence['context']);
        $this->event($evidence['executed'] ?? null, 'layout-template-executed', $evidence['context']);
    }

    private function beginTemplate($block, array $params, string $class): void
    {
        $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? [];
        $origin = $class === Template::class && ($caller['class'] ?? null) === Template::class
            && ($caller['function'] ?? null) === '_toHtml' ? ($this->blocks[$block]['template'] ?? null) : null;
        static $property;
        $property ??= new \ReflectionProperty(Template::class, 'templateContext');
        $this->fetching[] = ['origin' => $origin, 'executed' => false, 'file' => $params[0],
            'block' => $origin === null ? null : $property->getValue($block)];
    }

    private function renderTemplate($engine, array $params, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->fetching);
        if ($error || $index === null || $class !== Php::class) return;
        $frame = $this->fetching[$index];
        // The PHP engine can be intercepted by a plugin. Require its native
        // success on the exact context and file provided to fetchView.
        if ($frame['block'] === $params[0] && $frame['file'] === $params[1]) $this->fetching[$index]['executed'] = true;
    }

    private function completeTemplate($block, array $params, $result, ?\Throwable $error, string $class): void
    {
        $frame = array_pop($this->fetching);
        if (!$error && $frame['origin'] && $frame['executed']) {
            $state = $this->blocks[$block];
            $state['executed'] = $frame['origin'];
            $this->blocks[$block] = $state;
        }
    }

    private function event(?string $id, string $type, array $context): void
    {
        if ($id !== null) Recorder::layout($id, $type, $context);
    }
}
