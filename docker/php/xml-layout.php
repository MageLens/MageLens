<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\DataObject;
use Magento\Framework\Data\Structure as DataStructure;
use Magento\Framework\Filesystem\File\Read;
use Magento\Framework\View\Element\AbstractBlock;
use Magento\Framework\View\Element\Template;
use Magento\Framework\View\File;
use Magento\Framework\View\File\FileList;
use Magento\Framework\View\Layout;
use Magento\Framework\View\Layout\Generator\Block as BlockGenerator;
use Magento\Framework\View\Layout\GeneratorPool;
use Magento\Framework\View\Layout\Reader\Block as BlockReader;
use Magento\Framework\View\Layout\Reader\Container as ContainerReader;
use Magento\Framework\View\Layout\Reader\Move as MoveReader;
use Magento\Framework\View\Layout\ScheduledStructure;
use Magento\Framework\View\Layout\ScheduledStructure\Helper as SchedulingHelper;
use Magento\Framework\View\Model\Layout\Merge;
use Magento\Framework\View\Page\Builder as PageBuilder;
use Magento\Framework\View\Page\Layout\Reader as WireframeReader;
use Magento\Framework\View\TemplateEngine\Php;

final class LayoutCoverage
{
    private array $packages = [];
    private array $replacingFiles = [];
    private array $entries = [];
    private array $handles = [];
    private array $pageBuilders = [];
    private array $wireframes = [];
    private LayoutPageCoverage $page;
    private LayoutStructureCoverage $structureCoverage;
    private \WeakMap $merges;
    private array $documents = [];
    private array $appending = [];
    private array $contexts = [];
    private \WeakMap $structures;
    private \WeakMap $actionReads;
    private \WeakMap $argumentReads;
    private \WeakMap $moves;
    private \WeakMap $removals;
    private array $removalChanges = [];
    private array $removing = [];
    private array $moving = [];
    private array $generating = [];
    private array $constructing = [];
    private \WeakMap $blocks;
    private array $fetching = [];
    private bool $healthy = false;
    private bool $sourceTrace = false;
    private array $limitations = [];
    private array $errors = [];

    private function __construct(private readonly array $sources)
    {
        $this->merges = new \WeakMap();
        $this->page = new LayoutPageCoverage($this->origin(...));
        $this->structureCoverage = new LayoutStructureCoverage($this->origin(...));
        $this->structures = new \WeakMap();
        $this->actionReads = new \WeakMap();
        $this->argumentReads = new \WeakMap();
        $this->moves = new \WeakMap();
        $this->removals = new \WeakMap();
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
            [FileList::class, 'replace', $this->beginFileReplacement(...), $this->completeFileReplacement(...)],
            [Read::class, 'readAll', null, $this->readFile(...)],
            [Merge::class, '_loadXmlString', null, $this->parseFile(...)],
            [Merge::class, '_fetchRecursiveUpdates', $this->beginEntry(...), $this->traverseEntry(...)],
            [Merge::class, '_merge', $this->beginHandle(...), $this->completeHandle(...)],
            [Merge::class, '_fetchDbLayoutUpdates', null, $this->completeDatabaseUpdate(...)],
            [Merge::class, 'addUpdate', $this->beginUpdate(...), $this->appendUpdate(...)],
            [Merge::class, 'asSimplexml', null, $this->mergeDocument(...)],
            [Merge::class, 'load', $this->resetPageSelection(...), null],
            [Merge::class, '_loadCache', null, $this->cachedUpdate(...)],
            [ScheduledStructure::class, 'populateWithArray', null, $this->cachedStructure(...)],
            [ScheduledStructure::class, 'setStructureElementData', null, $this->checkScheduledWrite(...)],
            [ScheduledStructure::class, 'setElement', null, $this->checkScheduledWrite(...)],
            [Merge::class, 'getPageLayout', null, $this->readSelection(...)],
            [PageBuilder::class, 'readPageLayout', $this->beginPageRead(...), $this->completePageRead(...)],
            [WireframeReader::class, 'read', $this->beginWireframe(...), $this->completeWireframe(...)],
            [BlockReader::class, 'scheduleBlock', null, $this->scheduleBlock(...)],
            [BlockReader::class, 'scheduleReference', null, $this->scheduleReference(...)],
            [BlockReader::class, 'getActions', null, $this->readActions(...)],
            [BlockReader::class, 'getArguments', null, $this->readArguments(...)],
            [MoveReader::class, 'scheduleMove', null, $this->scheduleMove(...)],
            [GeneratorPool::class, 'moveElementInStructure', $this->beginMove(...), $this->completeMove(...)],
            [ScheduledStructure::class, 'setElementToRemoveList', $this->beginRemovalChange(...), $this->completeRemovalChange(...)],
            [ScheduledStructure::class, 'unsetElementFromListToRemove', $this->beginRemovalChange(...), $this->completeRemovalChange(...)],
            [GeneratorPool::class, 'removeElement', $this->beginRemoval(...), $this->completeRemoval(...)],
            [GeneratorPool::class, 'buildStructure', null, $this->finishStructure(...)],
            [Layout::class, 'generateElements', $this->beginElements(...), $this->generateElements(...)],
            [Layout::class, 'createIsolatedReaderContext', $this->snapshotContext(...), $this->mirrorContext(...)],
            [BlockGenerator::class, 'generateBlock', $this->beginBlock(...), $this->completeBlock(...)],
            [BlockGenerator::class, 'getBlockInstance', $this->beginClass(...), $this->constructedClass(...)],
            [DataStructure::class, 'addToParentGroup', null, $this->registeredGroup(...)],
            [DataObject::class, 'setData', null, $this->assignedTtl(...)],
            [BlockGenerator::class, 'generateAction', null, $this->completeAction(...)],
            [DataObject::class, 'setData', null, $this->applyArguments(...)],
            [Template::class, 'setTemplate', null, $this->assignTemplate(...)],
            [AbstractBlock::class, '_loadCache', null, $this->loadBlockHtml(...)],
            [AbstractBlock::class, 'toHtml', $this->beginRender(...), $this->completeRender(...)],
            [Template::class, 'fetchView', $this->beginTemplate(...), $this->completeTemplate(...)],
            [Php::class, 'render', null, $this->renderTemplate(...)],
            ...$this->page->hooks(),
            ...$this->structureCoverage->hooks(),
        ];
    }

    private function beginPackage($merge, array $params, string $class): void
    {
        if ($class === Merge::class) $this->packages[] = ['merge' => $merge, 'files' => [], 'pending' => null, 'replacements' => []];
    }

    private static function viewFiles(FileList $list): array
    {
        static $files;
        $files ??= new \ReflectionProperty(FileList::class, 'files');
        return $files->getValue($list);
    }

    private function beginFileReplacement($list, array $params, string $class): void
    {
        if ($class !== FileList::class) return;
        $index = array_key_last($this->packages);
        $this->replacingFiles[] = $index === null ? null
            : ['package' => $index, 'before' => self::viewFiles($list), 'incoming' => $params[0]];
    }

    private function completeFileReplacement($list, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== FileList::class) return;
        $frame = array_pop($this->replacingFiles);
        if ($error || !$frame || $frame['package'] !== array_key_last($this->packages)) return;
        foreach (self::viewFiles($list) as $identifier => $file) {
            $before = $frame['before'][$identifier] ?? null;
            if (!$file instanceof File || !$before instanceof File || $file === $before
                || !in_array($file, $frame['incoming'], true)) continue;
            $index = $frame['package'];
            $path = $file->getFilename();
            $previous = $before->getFilename();
            $displaced = $this->packages[$index]['replacements'][$previous] ?? [];
            $this->packages[$index]['replacements'][$path] = array_values(array_unique([...$displaced, $previous]));
        }
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
            'replacements' => $this->packages[$index]['replacements'][$pending['path']] ?? [],
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
        $replacements = [];
        foreach ($xml->children() as $entry) {
            $file = $package['files'][count($entries)];
            $digest = hash('sha256', $entry->innerXml());
            if ($entry->getAttribute('id') !== $file['handle'] || $digest !== $file['hash']) return;
            $entries[dom_import_simplexml($entry)->getNodePath()] = $file['targets'];
            if ($file['replacements']) $replacements[dom_import_simplexml($entry)->getNodePath()] = $file['replacements'];
        }
        $state = $this->merges[$merge] ?? [];
        $state['package'] = ['root' => dom_import_simplexml($xml), 'entries' => $entries, 'replacements' => $replacements];
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
            $replaced = $package['replacements'][$entry->getNodePath()] ?? [];
            if (isset($source[0]['ids']['file-override'])) {
                $theme = $merge->getTheme();
                $this->event($source[0]['ids']['file-override'], $replaced
                    ? 'layout-file-override-selected' : 'layout-file-override-unconfirmed',
                    ['area' => $theme->getArea(), 'theme' => $theme->getFullPath()]);
            }
            if ($replaced) {
                $theme = $merge->getTheme();
                $context = ['area' => $theme->getArea(), 'theme' => $theme->getFullPath()];
                foreach ($replaced as $path) {
                    $relative = str_starts_with($path, BP . '/') ? substr($path, strlen(BP) + 1) : '';
                    foreach ($this->sources[$relative]['targets'] ?? [] as $target) {
                        foreach ($target['ids'] as $id) $this->event($id, 'layout-file-overridden', $context);
                    }
                }
            }
            $this->findWireframe($merge, $entry, $source[0]['ids']['wireframe'] ?? null);
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
        if ($error) return;
        $state = $this->merges[$merge] ?? [];
        if (isset($params[0]['layout'])) unset($state['pageLayout']);
        $entry = dom_import_simplexml($params[0]);
        $package = $state['package'] ?? null;
        if ($package && $entry->ownerDocument->documentElement->isSameNode($package['root'])) {
            $targets = $package['entries'][$entry->getNodePath()] ?? [];
            $state['pending'] = ['hash' => hash('sha256', $params[0]->innerXml()), 'targets' => $targets];
            if (isset($targets[0]['selection']) && $entry->getAttribute('layout') === $targets[0]['selection']) {
                $state['pageLayout'] = ['name' => $targets[0]['selection'], 'id' => $targets[0]['ids']['wireframe-selection']];
            }
        }
        $this->merges[$merge] = $state;
    }

    private function resetPageSelection($merge, array $params, string $class): void
    {
        if ($class !== Merge::class) return;
        $state = $this->merges[$merge] ?? [];
        unset($state['pageLayout']);
        $this->merges[$merge] = $state;
    }

    private function cachedUpdate($merge, array $params, $value, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== Merge::class || !$value) return;
        $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? [];
        if (($caller['class'] ?? null) !== Merge::class) return;
        $reason = match ($caller['function'] ?? null) {
            'load' => 'layout-merge-cache',
            'getFileLayoutUpdatesXml' => 'layout-package-cache',
            default => null,
        };
        if ($reason !== null) $this->limitations[$reason] = true;
    }

    private function cachedStructure($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== ScheduledStructure::class) return;
        unset($this->structures[$structure], $this->moves[$structure], $this->removals[$structure]);
        $this->structureCoverage->reset($structure);
        $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? [];
        if (($caller['class'] ?? null) === Layout::class && ($caller['function'] ?? null) === 'generateElements') {
            $this->limitations['scheduled-layout-cache'] = true;
        }
    }

    private function beginPageRead($builder, array $params, string $class): void
    {
        if ($class === PageBuilder::class) {
            $method = new \ReflectionMethod($builder, 'getPageLayout');
            $this->pageBuilders[] = ['selection' => null, 'native' => $method->getDeclaringClass()->getName() === PageBuilder::class];
        }
    }

    private function completePageRead($builder, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class === PageBuilder::class) array_pop($this->pageBuilders);
    }

    private function readSelection($merge, array $params, $result, ?\Throwable $error, string $class): void
    {
        $frame = array_key_last($this->pageBuilders);
        if ($frame === null || !$this->pageBuilders[$frame]['native'] || $error || $class !== Merge::class) return;
        $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 6);
        $selection = $this->merges[$merge]['pageLayout'] ?? null;
        if (!$selection || $selection['name'] !== $result) return;
        for ($depth = 2; isset($trace[$depth]) && $trace[$depth]['function'] === 'getPageLayout'; $depth++) {
            if (($trace[$depth]['class'] ?? null) !== PageBuilder::class) continue;
            $wrapper = get_class($merge);
            $selection['confirmed'] = $depth === 2 || ($depth === 3 && str_ends_with($wrapper, '\\Interceptor')
                && ($trace[2]['class'] ?? null) === $wrapper);
            $this->pageBuilders[$frame]['selection'] = $selection;
            return;
        }
    }

    private function beginWireframe($reader, array $params, string $class): void
    {
        if ($class !== WireframeReader::class) return;
        $frame = array_key_last($this->pageBuilders);
        $selection = $this->pageBuilders[$frame]['selection'] ?? null;
        $this->wireframes[] = ['reader' => $reader, 'name' => $params[1], 'roots' => [], 'context' => null,
            'selection' => $selection && $selection['name'] === $params[1] ? $selection : null];
    }

    private function findWireframe($merge, \DOMElement $entry, ?string $id): void
    {
        $index = array_key_last($this->wireframes);
        if ($index === null || $entry->tagName !== 'layout' || $entry->getAttribute('id') !== $this->wireframes[$index]['name']) return;
        static $property;
        $property ??= new \ReflectionProperty(WireframeReader::class, 'pageLayoutMerge');
        if ($property->getValue($this->wireframes[$index]['reader']) !== $merge) return;
        $theme = $merge->getTheme();
        $this->wireframes[$index]['context'] = ['area' => $theme->getArea(), 'theme' => $theme->getFullPath()];
        if ($id !== null) $this->wireframes[$index]['roots'][$id] = true;
    }

    private function completeWireframe($reader, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== WireframeReader::class) return;
        $frame = array_pop($this->wireframes);
        if ($error || !$frame || $frame['context'] === null) return;
        foreach (array_keys($frame['roots']) as $id) $this->event($id, 'layout-wireframe-selected', $frame['context']);
        if ($frame['selection'] !== null) {
            $selection = $frame['selection'];
            $effect = $selection['confirmed'] ? 'layout-wireframe-selected' : 'layout-wireframe-origin-unconfirmed';
            $this->event($selection['id'], $effect, $frame['context']);
        }
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
        $caller = self::nativeCaller($merge, 'addUpdate');
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

    private static function nativeCaller(object $subject, string $method): array
    {
        $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 5);
        $caller = $trace[3] ?? [];
        // A generated interceptor calls the parent directly when no plugin
        // runs. Actual plugin dispatch inserts additional frames.
        $wrapper = get_class($subject);
        if (str_ends_with($wrapper, '\\Interceptor') && ($caller['class'] ?? null) === $wrapper
            && ($caller['function'] ?? null) === $method) {
            return $trace[4] ?? [];
        }
        return $caller;
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
                    // The native merge appends the body of each package entry.
                    if ($ordinal === 0) continue;
                    $node = $allNodes->item($offset + $ordinal - 1);
                    if (!$node) return;
                    $identity = $node->getAttribute(match ($node->tagName) {
                        'update' => 'handle',
                        'move' => 'element',
                        'action' => 'method',
                        'remove' => $node->parentNode->nodeName === 'head' ? 'src' : 'name',
                        default => 'name',
                    });
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
        [$origin, $context] = $this->origin($xml);
        if ($context !== null) $block['context'] = $context;
        if ($declaration) $block['block'] = $origin['block'] ?? null;
        $data = $structure->getStructureElementData($name, []);
        foreach (['class', 'group', 'ttl'] as $attribute) {
            if (!isset($xml[$attribute])) continue;
            $previous = $block['attributes'][$attribute] ?? null;
            $id = $origin['block-' . $attribute] ?? null;
            if ($previous && $previous['id'] !== $id) $block['overriddenAttributes'][$previous['id']] = true;
            unset($block['attributes'][$attribute]);
            if ($id !== null && ($data['attributes'][$attribute] ?? null) === (string) $xml[$attribute]) {
                $block['attributes'][$attribute] = ['id' => $id, 'value' => (string) $xml[$attribute]];
            }
        }
        $block['actions'] = $this->bindActions($xml, $data['actions'] ?? [], $block['actions'] ?? []);
        $block['arguments'] = $this->bindArguments($xml, $data['arguments'] ?? [], $block['arguments'] ?? []);
        $actual = $data['attributes']['template'] ?? null;
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

    private static function digest(array $data): string
    {
        return hash('sha256', serialize($data));
    }

    private function readActions($reader, array $params, $actions, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== BlockReader::class) return;
        $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? [];
        if (($caller['class'] ?? null) !== BlockReader::class || ($caller['function'] ?? null) !== 'updateScheduledData') return;
        if ((new \ReflectionMethod($reader, 'getActions'))->getDeclaringClass()->getName() !== BlockReader::class) return;
        $xml = $params[0];
        $origins = [];
        foreach ($xml->action as $node) {
            [$origin] = $this->origin($node);
            $arguments = [];
            foreach ($node->argument as $argument) {
                [$argumentOrigin] = $this->origin($argument);
                if (isset($argumentOrigin['action-argument'])) $arguments[] = $argumentOrigin['action-argument'];
            }
            $origins[] = ['id' => $origin['action'] ?? null, 'arguments' => $arguments];
        }
        if (count($origins) !== count($actions)) return;
        $this->actionReads[$xml] = array_map(
            static fn($action, $origin) => ['digest' => self::digest($action), ...$origin],
            $actions,
            $origins
        );
    }

    private function bindActions($xml, array $actions, array $previous): array
    {
        $read = $this->actionReads[$xml] ?? null;
        unset($this->actionReads[$xml]);
        if ($read === null || !$actions) return [];
        $offset = count($actions) - count($read);
        if ($offset < 0) return [];
        // The reader appends declarations to the existing list. A repeated
        // block declaration can replace the list, leaving no prefix.
        $expected = array_merge(array_slice($previous, 0, $offset), $read);
        if (count($expected) !== count($actions)) return [];
        foreach ($actions as $index => $action) {
            if (self::digest($action) !== $expected[$index]['digest']) return [];
        }
        return $expected;
    }

    private function readArguments($reader, array $params, $arguments, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== BlockReader::class) return;
        $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? [];
        if (($caller['class'] ?? null) !== BlockReader::class || ($caller['function'] ?? null) !== 'evaluateArguments') return;
        if ((new \ReflectionMethod($reader, 'getArguments'))->getDeclaringClass()->getName() !== BlockReader::class) return;
        $xml = $params[0];
        $origins = [];
        foreach ($xml->arguments[0]->argument ?? [] as $node) {
            $origins[$node->getAttribute('name')] = $this->argumentOrigins($node);
        }
        if (array_keys($origins) === array_keys($arguments)) $this->argumentReads[$xml] = $origins;
    }

    private function argumentOrigins($node): array
    {
        [$origin] = $this->origin($node);
        if (isset($origin['argument'])) return ['id' => $origin['argument']];
        if ((string) $node->attributes('http://www.w3.org/2001/XMLSchema-instance')->type !== 'array'
            || isset($node->updater)) return [];
        $children = [];
        foreach ($node->item as $item) $children[$item->getAttribute('name')] = $this->argumentOrigins($item);
        return ['children' => $children];
    }

    private function bindArguments($xml, array $values, array $previous): array
    {
        $read = $this->argumentReads[$xml] ?? null;
        unset($this->argumentReads[$xml]);
        if ($read === null) return [];
        return $this->bindArgumentLeaves($read, $values, $previous);
    }

    private function bindArgumentLeaves(array $read, array $values, array $previous): array
    {
        foreach ($read as $name => $origin) {
            if (isset($origin['children']) && isset($values[$name]) && is_array($values[$name])) {
                $previous[$name] = ['children' => $this->bindArgumentLeaves($origin['children'], $values[$name], $previous[$name]['children'] ?? [])];
                continue;
            }
            unset($previous[$name]);
            if (isset($origin['id']) && array_key_exists($name, $values)
                && (is_scalar($values[$name]) || $values[$name] === null)) {
                $previous[$name] = ['id' => $origin['id'], 'digest' => self::digest([$values[$name]])];
            }
        }
        return $this->matchingArguments($previous, $values);
    }

    private function matchingArguments(array $origins, array $values): array
    {
        $matched = [];
        foreach ($origins as $name => $origin) {
            if (!array_key_exists($name, $values)) continue;
            $value = $values[$name];
            if (isset($origin['children']) && is_array($value)) {
                $matched[$name] = ['children' => $this->matchingArguments($origin['children'], $value)];
            } elseif (isset($origin['digest']) && (is_scalar($value) || $value === null)
                && self::digest([$value]) === $origin['digest']) {
                $matched[$name] = $origin;
            }
        }
        return $matched;
    }

    private function appliedArgumentIds(array $origins): array
    {
        $ids = [];
        foreach ($origins as $origin) {
            if (isset($origin['id'])) $ids[] = $origin['id'];
            if (isset($origin['children'])) array_push($ids, ...$this->appliedArgumentIds($origin['children']));
        }
        return $ids;
    }

    private function checkScheduledWrite($schedule, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== ScheduledStructure::class) return;
        $name = $params[0];
        $state = $this->structures[$schedule] ?? [];
        if (!isset($state[$name])) return;
        $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 4);
        $caller = $trace[2] ?? [];
        $wrapper = get_class($schedule);
        if (str_ends_with($wrapper, '\\Interceptor') && ($caller['class'] ?? null) === $wrapper
            && ($caller['function'] ?? null) === $trace[1]['function']) {
            $caller = $trace[3] ?? [];
        }
        if ((($caller['class'] ?? null) === BlockReader::class
                && in_array($caller['function'], ['scheduleBlock', 'scheduleReference'], true))
            || (($caller['class'] ?? null) === SchedulingHelper::class && $caller['function'] === 'scheduleElement')) {
            return;
        }
        unset($state[$name]);
        $this->structures[$schedule] = $state;
    }

    private function origin($xml): array
    {
        $node = dom_import_simplexml($xml);
        foreach ($this->documents as $document) {
            if ($node->ownerDocument->documentElement->isSameNode($document['root'])) {
                return [$document['targets'][$node->getNodePath()] ?? [], $document['context']];
            }
        }
        return [[], null];
    }

    private function scheduleMove($reader, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== MoveReader::class) return;
        [$schedule, $xml] = $params;
        $name = $xml->getAttribute('element');
        [$origin, $context] = $this->origin($xml);
        $moves = $this->moves[$schedule] ?? [];
        unset($moves[$name]);
        if (isset($origin['move'])) {
            $moves[$name] = ['id' => $origin['move'], 'context' => $context,
                'data' => $schedule->getElementToMove($name), 'effect' => null];
        }
        $this->moves[$schedule] = $moves;
    }

    private static function placement($structure, string $element): array
    {
        $parent = $structure->getParentId($element);
        return [$parent, $parent ? $structure->getChildAlias($parent, $element) : null,
            $parent ? array_keys($structure->getChildren($parent)) : []];
    }

    private function beginMove($pool, array $params, string $class): void
    {
        if ($class !== GeneratorPool::class) return;
        [$schedule, $structure, $name] = $params;
        $tracked = $this->moves[$schedule][$name] ?? null;
        $this->moving[] = $tracked && $tracked['data'] === $schedule->getElementToMove($name)
            ? self::placement($structure, $name) : null;
    }

    private function completeMove($pool, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== GeneratorPool::class) return;
        $before = array_pop($this->moving);
        if ($error || $before === null) return;
        [$schedule, $structure, $name] = $params;
        $moves = $this->moves[$schedule];
        $after = self::placement($structure, $name);
        $destination = $moves[$name]['data'][0];
        $moves[$name]['effect'] = match (true) {
            $after[0] !== $destination => 'unresolved',
            $before === $after => 'unchanged',
            default => 'applied',
        };
        $this->moves[$schedule] = $moves;
    }

    private function finishStructure($pool, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== GeneratorPool::class) return;
        [$schedule, $structure] = $params;
        foreach ($this->moves[$schedule] ?? [] as $name => $move) {
            if ($move['data'] !== $schedule->getElementToMove($name)) continue;
            $effect = $move['effect'];
            if ($effect === null) $effect = $structure->hasElement($name) ? 'unresolved' : 'target-missing';
            if ($effect === 'applied' && !$schedule->hasElement($name)) $effect = 'removed';
            $this->event($move['id'], 'layout-move-' . $effect, $move['context']);
        }
        foreach ($this->removals[$schedule] ?? [] as $name => $entry) {
            foreach ($entry['canceled'] ?? [] as $id => $context) $this->event($id, 'layout-removal-canceled', $context);
            if (isset($entry['restore']) && $schedule->hasElement($name)) {
                $this->event($entry['restore']['id'], 'layout-removal-restored', $entry['restore']['context']);
            }
        }
    }

    private static function removalQueued($schedule, string $name): bool
    {
        static $property;
        $property ??= new \ReflectionProperty(ScheduledStructure::class, 'scheduledRemoves');
        return isset($property->getValue($schedule)[$name]);
    }

    private function beginRemovalChange($schedule, array $params, string $class): void
    {
        if ($class === ScheduledStructure::class) $this->removalChanges[] = self::removalQueued($schedule, $params[0]);
    }

    private function completeRemovalChange($schedule, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== ScheduledStructure::class) return;
        $before = array_pop($this->removalChanges);
        $name = $params[0];
        $queued = self::removalQueued($schedule, $name);
        if ($error || $queued === $before) return;

        // Associate only the two native reference readers with an XML source.
        $caller = debug_backtrace(0, 3)[2] ?? [];
        $method = [$caller['class'] ?? null, $caller['function'] ?? null];
        $reference = in_array($method, [[BlockReader::class, 'scheduleReference'], [ContainerReader::class, 'containerReference']], true);
        $xml = $reference ? ($caller['args'][1] ?? null) : null;
        [$origin, $context] = $xml instanceof Layout\Element ? $this->origin($xml) : [[], null];
        $id = $origin['removal'] ?? null;

        $removals = $this->removals[$schedule] ?? [];
        $entry = $removals[$name] ?? [];
        if ($queued) {
            unset($entry['restore']);
            $entry['remove'] = $id === null ? null : ['id' => $id, 'context' => $context];
        } elseif ($reference) {
            if (isset($entry['remove'])) $entry['canceled'][$entry['remove']['id']] = $entry['remove']['context'];
            unset($entry['remove']);
            $entry['restore'] = $id === null ? null : ['id' => $id, 'context' => $context];
        } else {
            unset($entry['remove'], $entry['restore']);
        }
        $removals[$name] = $entry;
        $this->removals[$schedule] = $removals;
    }

    private function beginRemoval($pool, array $params, string $class): void
    {
        if ($class !== GeneratorPool::class) return;
        [$schedule, , $name] = $params;
        $this->removing[] = !($params[3] ?? false) && $schedule->hasElement($name) && self::removalQueued($schedule, $name)
            ? ($this->removals[$schedule][$name]['remove'] ?? null) : null;
    }

    private function completeRemoval($pool, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== GeneratorPool::class) return;
        $removal = array_pop($this->removing);
        if (!$error && $removal && !$params[0]->hasElement($params[2])) {
            $this->event($removal['id'], 'layout-removal-applied', $removal['context']);
        }
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
        $context = self::readerContext($layout);
        if ($context !== null) {
            $structure = $context->getScheduledStructure();
            unset($this->structures[$structure], $this->moves[$structure], $this->removals[$structure]);
            $this->page->reset($context->getPageConfigStructure());
            $this->structureCoverage->reset($structure);
        }
    }

    private function generateElements($layout, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== Layout::class) return;
        $this->healthy = true;
        $xml = $layout->getNode();
        if (!$xml instanceof Layout\Element) return;
        $node = dom_import_simplexml($xml);
        $context = self::readerContext($layout);
        foreach ($this->documents as $document) {
            if ($node->isSameNode($document['root']) && (isset($this->structures[$context->getScheduledStructure()])
                || $this->page->snapshot($context->getPageConfigStructure())
                || $this->structureCoverage->snapshot($context->getScheduledStructure()))) {
                $this->sourceTrace = true;
                return;
            }
        }
        $this->limitations['missing-layout-origins'] = true;
    }

    private function snapshotContext($layout, array $params, string $class): void
    {
        if ($class !== Layout::class) return;
        $context = self::readerContext($layout);
        $source = $context->getScheduledStructure();
        $this->contexts[] = [$this->structures[$source] ?? [], $this->moves[$source] ?? [], $this->removals[$source] ?? [],
            $this->page->snapshot($context->getPageConfigStructure()), $this->structureCoverage->snapshot($source)];
    }

    private function mirrorContext($layout, array $params, $context, ?\Throwable $error, string $class): void
    {
        if ($class !== Layout::class) return;
        [$blocks, $moves, $removals, $page, $containers] = array_pop($this->contexts);
        if ($error) return;
        $schedule = $context->getScheduledStructure();
        if ($blocks) $this->structures[$schedule] = $blocks;
        if ($moves) $this->moves[$schedule] = $moves;
        if ($removals) $this->removals[$schedule] = $removals;
        $this->page->restore($context->getPageConfigStructure(), $page);
        $this->structureCoverage->restore($schedule, $containers);
    }

    private function beginBlock($generator, array $params, string $class): void
    {
        if ($class !== BlockGenerator::class) return;
        $this->generating[] = ['source' => $this->structures[$params[0]][$params[2]] ?? [], 'selected' => null,
            'generator' => get_class($generator), 'applied' => [], 'name' => $params[2], 'class' => null, 'ttl' => null, 'group' => false];
    }

    private function beginClass($generator, array $params, string $class): void
    {
        if ($class !== BlockGenerator::class) return;
        $index = array_key_last($this->generating);
        $origin = $index === null ? null : ($this->generating[$index]['source']['attributes']['class'] ?? null);
        $caller = self::nativeCaller($generator, 'getBlockInstance');
        $eligible = $origin && $origin['value'] !== '' && $origin['value'] === $params[0]
            && ($caller['class'] ?? null) === BlockGenerator::class && ($caller['function'] ?? null) === 'createBlock';
        $this->constructing[] = $eligible ? $index : null;
    }

    private function constructedClass($generator, array $params, $block, ?\Throwable $error, string $class): void
    {
        if ($class !== BlockGenerator::class) return;
        $index = array_pop($this->constructing);
        if (!$error && $index !== null && $index === array_key_last($this->generating) && $block instanceof AbstractBlock) {
            $this->generating[$index]['class'] = $block;
        }
    }

    private function registeredGroup($structure, array $params, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->generating);
        if ($error || $class !== DataStructure::class || $index === null || $result !== true) return;
        $frame = $this->generating[$index];
        $origin = $frame['source']['attributes']['group'] ?? null;
        $caller = self::nativeCaller($structure, 'addToParentGroup');
        if ($origin && $frame['name'] === $params[0] && $origin['value'] === $params[1]
            && ($caller['class'] ?? null) === BlockGenerator::class && ($caller['function'] ?? null) === 'generateBlock') {
            $this->generating[$index]['group'] = true;
        }
    }

    private function assignedTtl($block, array $params, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->generating);
        if ($error || $class !== DataObject::class || $index === null || ($params[0] ?? null) !== 'ttl') return;
        $origin = $this->generating[$index]['source']['attributes']['ttl'] ?? null;
        $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 4);
        if ($origin && (int) $origin['value'] === ($params[1] ?? null)
            && ($trace[2]['class'] ?? null) === DataObject::class && ($trace[2]['function'] ?? null) === '__call'
            && ($trace[3]['class'] ?? null) === BlockGenerator::class && ($trace[3]['function'] ?? null) === 'generateBlock') {
            $this->generating[$index]['ttl'] = $block;
        }
    }

    private function applyArguments($block, array $params, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->generating);
        if ($error || $class !== DataObject::class || !$block instanceof AbstractBlock || $index === null) return;
        $frame = $this->generating[$index];
        $origins = $frame['source']['arguments'] ?? [];
        if (!$origins) return;
        $expected = [
            [DataObject::class, 'setData', get_class($block)],
            [DataObject::class, 'addData', get_class($block)],
            [BlockGenerator::class, 'createBlock', $frame['generator']],
            [BlockGenerator::class, 'generateBlock', ''],
        ];
        $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 8);
        $depth = 1;
        foreach ($expected as [$native, $method, $wrapper]) {
            $call = $trace[$depth++] ?? [];
            if (($call['class'] ?? null) !== $native || ($call['function'] ?? null) !== $method) return;
            $caller = $trace[$depth] ?? [];
            if (str_ends_with($wrapper, '\\Interceptor') && ($caller['class'] ?? null) === $wrapper
                && ($caller['function'] ?? null) === $method) {
                $depth++;
            }
        }
        $key = $params[0] ?? '';
        $values = is_array($key) ? $key : [$key => $params[1] ?? null];
        foreach ($this->appliedArgumentIds($this->matchingArguments($origins, $values)) as $id) {
            $this->generating[$index]['applied'][$id] = $block;
        }
    }

    private function completeBlock($generator, array $params, $block, ?\Throwable $error, string $class): void
    {
        if ($class !== BlockGenerator::class) return;
        $frame = array_pop($this->generating);
        if (empty($frame['source']['context'])) return;
        if ($error) {
            $this->event($frame['source']['block'] ?? null, 'layout-block-generation-failed', $frame['source']['context']);
            return;
        }
        if (!$block instanceof AbstractBlock) return;
        $source = $frame['source'];
        $context = $source['context'];
        $blockId = $source['block'] ?? null;
        $templateId = $frame['selected'] === $block ? ($source['template'] ?? null) : null;
        foreach (array_keys($source['overridden'] ?? []) as $previous) {
            if ($previous !== $templateId) $this->event($previous, 'layout-template-overridden', $context);
        }
        $this->event($blockId, 'layout-block-created', $context);
        $this->event($templateId, 'layout-template-selected', $context);
        foreach (array_keys($source['overriddenAttributes'] ?? []) as $id) {
            $this->event($id, 'layout-block-attribute-overridden', $context);
        }
        foreach (['class', 'ttl'] as $attribute) {
            if ($frame[$attribute] === $block) {
                $this->event($source['attributes'][$attribute]['id'], 'layout-block-' . $attribute . '-applied', $context);
            }
        }
        if ($frame['group']) $this->event($source['attributes']['group']['id'], 'layout-block-group-applied', $context);
        foreach ($frame['applied'] as $id => $target) {
            if ($block === $target) $this->event($id, 'layout-argument-applied', $context);
        }
        $this->blocks[$block] = ['block' => $blockId, 'template' => $templateId, 'context' => $context,
            'actions' => $this->actionCalls($params[0], $params[2], $source['actions'] ?? [])];
    }

    private function actionCalls($schedule, string $name, array $origins): array
    {
        if (!$origins) return [];
        $actions = $schedule->getElement($name)[1]['actions'] ?? [];
        if (count($actions) !== count($origins)) return [];
        $calls = [];
        foreach ($actions as $index => $action) {
            if (self::digest($action) !== $origins[$index]['digest']) return [];
            $calls[self::digest([$action[0], $action[1]])][] = [
                'id' => $origins[$index]['id'], 'arguments' => $origins[$index]['arguments'] ?? []];
        }
        return $calls;
    }

    private function completeAction($generator, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== BlockGenerator::class) return;
        [$block, $method, $arguments] = $params;
        if (empty($this->blocks[$block]['actions'])) return;
        $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? [];
        if (($caller['class'] ?? null) !== BlockGenerator::class || ($caller['function'] ?? null) !== 'process') return;
        if ((new \ReflectionMethod($generator, 'generateAction'))->getDeclaringClass()->getName() !== BlockGenerator::class) return;
        $state = $this->blocks[$block];
        $origins = $state['actions'][self::digest([$method, $arguments])] ?? [];
        $effect = count($origins) === 1 ? 'layout-action-executed' : 'layout-action-ambiguous';
        foreach ($origins as $origin) {
            $this->event($origin['id'], $effect, $state['context']);
            foreach ($origin['arguments'] as $id) {
                $this->event($id, count($origins) === 1 ? 'layout-action-argument-applied' : 'layout-action-argument-ambiguous', $state['context']);
            }
        }
    }

    private function assignTemplate($block, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error) return;
        $caller = self::nativeCaller($block, 'setTemplate');
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
        $caller = self::nativeCaller($block, 'fetchView');
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
        if ($error && $frame['origin']) {
            $this->event($frame['origin'], 'layout-template-failed', $this->blocks[$block]['context']);
        }
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
