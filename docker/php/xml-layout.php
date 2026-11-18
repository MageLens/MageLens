<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\DataObject;
use Magento\Framework\ObjectManager\ObjectManager;
use Magento\Framework\Simplexml\Config as XmlConfig;
use Magento\Framework\Data\Structure as DataStructure;
use Magento\Framework\Filesystem\File\Read;
use Magento\Framework\View\Element\AbstractBlock;
use Magento\Framework\View\Element\BlockFactory;
use Magento\Framework\View\Element\Template;
use Magento\Framework\View\File;
use Magento\Framework\View\File\FileList;
use Magento\Framework\View\Layout;
use Magento\Framework\View\Layout\Generator\Block as BlockGenerator;
use Magento\Framework\View\Layout\Argument\Interpreter\Decorator\Updater;
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
    private const THEME_READERS = [
        \Magento\Framework\View\File\Collector\Base::class => 'area',
        \Magento\Framework\View\File\Collector\Theme::class => 'theme',
        \Magento\Framework\View\File\Collector\ThemeModular::class => 'theme',
        \Magento\Framework\View\File\Collector\Override\Base::class => 'theme',
        \Magento\Framework\View\File\Collector\Override\ThemeModular::class => 'theme',
    ];
    private array $packages = [];
    private array $replacingFiles = [];
    private array $entries = [];
    private array $handles = [];
    private array $pageBuilders = [];
    private array $wireframes = [];
    private LayoutPageCoverage $page;
    private LayoutStructureCoverage $structureCoverage;
    private LayoutPositionCoverage $positions;
    private LayoutRegistryCoverage $registry;
    private LayoutXmlOwnership $ownership;
    private LayoutPackageEvents $packageEvents;
    private LayoutArgumentOwnership $argumentOwnership;
    private LayoutTemplateOwnership $templateOwnership;
    private LayoutBlockRendering $blockRendering;
    private LayoutHandleMetadata $handleMetadata;
    private LayoutSelectionOwnership $selectionOwnership;
    private array $blockRenders = [];
    private int $blockRenderOverflow = 0;
    private LayoutBeforePluginOwnership $engineBeforePlugin;
    private array $actionEvaluations = [];
    private int $actionEvaluationOverflow = 0;
    private \WeakMap $merges;
    private \WeakMap $themeContexts;
    private array $documents = [];
    private array $appending = [];
    private array $contexts = [];
    private \WeakMap $structures;
    private \WeakMap $actionReads;
    private \WeakMap $argumentReads;
    private \WeakMap $argumentBindings;
    private array $argumentSchedules = [];
    private array $updatingArguments = [];
    private \WeakMap $moves;
    private \WeakMap $removals;
    private array $removalChanges = [];
    private array $removing = [];
    private array $moving = [];
    private array $generating = [];
    private array $constructing = [];
    private array $blockObjectCreations = [];
    private int $blockObjectOverflow = 0;
    private \WeakMap $blocks;
    private array $loadingPages = [];
    private int $loadingPagesOverflow = 0;
    private array $loadingHtml = [];
    private int $loadingHtmlOverflow = 0;
    private array $fetching = [];
    private int $fetchingOverflow = 0;
    private bool $healthy = false;
    private bool $sourceTrace = false;
    private array $limitations = [];
    private array $errors = [];
    private array $validating = [];

    private function __construct(private readonly array $sources)
    {
        $this->merges = new \WeakMap();
        $this->themeContexts = new \WeakMap();
        $this->page = new LayoutPageCoverage($this->origin(...));
        $this->structureCoverage = new LayoutStructureCoverage($this->origin(...), self::valueFingerprint(...), self::matchesFingerprint(...));
        $this->positions = new LayoutPositionCoverage($this->origin(...));
        $this->registry = new LayoutRegistryCoverage($sources, $this->registryContext(...), $this->event(...));
        $this->ownership = new LayoutXmlOwnership($this->observeXmlReceiver(...), $this->unverifiedProducer(...));
        $this->templateOwnership = new LayoutTemplateOwnership($this->ownership);
        $this->blockRendering = new LayoutBlockRendering($this->ownership);
        $this->handleMetadata = new LayoutHandleMetadata($this->ownership, $this->packageOrigin(...));
        $this->selectionOwnership = new LayoutSelectionOwnership($this->ownership, $this->readSelection(...));
        $this->engineBeforePlugin = new LayoutBeforePluginOwnership([
            'native' => Php::class, 'method' => 'render', 'name' => 'php_template_engine_plugin',
            'plugin' => 'Hyva\\Theme\\Plugin\\TemplateEngine\\PhpPlugin', 'callback' => 'beforeRender',
            'label' => 'template engine', 'pluginLabel' => 'template engine before-plugin',
        ]);
        $this->argumentOwnership = new LayoutArgumentOwnership(self::valueFingerprint(...), self::matchesFingerprint(...));
        $this->packageEvents = new LayoutPackageEvents($this->packageEventKnown(...),
            fn($xml) => $this->observeXmlReceiver($xml, false, false));
        $this->structures = new \WeakMap();
        $this->actionReads = new \WeakMap();
        $this->argumentReads = new \WeakMap();
        $this->argumentBindings = new \WeakMap();
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
        $this->ownership->finish();
        $this->templateOwnership->finish();
        $this->selectionOwnership->finish();
        $blockLimits = $this->blockRendering->finish();
        $metadataLimits = $this->handleMetadata->finish();
        if ($this->blockRenders || $this->blockRenderOverflow) $this->errors['Unbalanced block render hook evidence'] = true;
        $this->engineBeforePlugin->finish();
        if ($this->fetching || $this->fetchingOverflow) $this->errors['Unbalanced template rendering hook evidence'] = true;
        if ($this->loadingPages || $this->loadingPagesOverflow) $this->errors['Unbalanced full-page cache hook evidence'] = true;
        if ($this->loadingHtml || $this->loadingHtmlOverflow) $this->errors['Unbalanced block HTML cache hook evidence'] = true;
        $this->packageEvents->finish();
        $this->argumentOwnership->finish();
        if ($this->blockObjectCreations || $this->blockObjectOverflow) $this->errors['Unbalanced block object creation hook evidence'] = true;
        if ($this->actionEvaluations) $this->errors['Unbalanced native layout action hook evidence'] = true;
        if ($this->errors) throw new \RuntimeException(implode('; ', array_keys($this->errors)));
        [$structureHealthy, $structureLimits] = $this->structureCoverage->finish();
        [$registryHealthy, $registryLimits] = $this->registry->finish();
        return [$this->healthy || $registryHealthy || $structureHealthy, $this->sourceTrace, array_values(array_unique([...array_keys($this->limitations), ...$registryLimits, ...$structureLimits, ...$blockLimits, ...$metadataLimits]))];
    }

    private function hooks(): array
    {
        return [
            ...$this->ownership->hooks(),
            ...$this->packageEvents->hooks(),
            ...$this->argumentOwnership->hooks(),
            ...$this->blockRendering->hooks(),
            ...$this->handleMetadata->hooks(),
            ...$this->selectionOwnership->hooks(),
            [\Magento\Framework\View\File\CollectorInterface::class, 'getFiles', $this->expectTheme(...), null],
            [Merge::class, 'generateCacheId', $this->expectTheme(...), null],
            [\Magento\Framework\View\Design\ThemeInterface::class, 'getArea', null, $this->observeTheme(...)],
            [\Magento\Framework\View\Design\ThemeInterface::class, 'getFullPath', null, $this->observeTheme(...)],
            [Merge::class, '_loadFileLayoutUpdatesXml', $this->beginPackage(...), $this->completePackage(...)],
            [Layout\ProcessorInterface::class, 'getFileLayoutUpdatesXml', $this->beginPackageAccess(...), $this->packageAccess(...)],
            [FileList::class, 'replace', $this->beginFileReplacement(...), $this->completeFileReplacement(...)],
            [Read::class, 'readAll', null, $this->readFile(...)],
            [Merge::class, '_loadXmlString', null, $this->parseFile(...)],
            [Merge::class, '_fetchRecursiveUpdates', $this->beginEntry(...), $this->traverseEntry(...)],
            [Merge::class, '_merge', $this->beginHandle(...), $this->completeHandle(...)],
            [Merge::class, '_fetchDbLayoutUpdates', null, $this->completeDatabaseUpdate(...)],
            [Merge::class, 'addUpdate', $this->beginUpdate(...), $this->appendUpdate(...)],
            [Layout\ProcessorInterface::class, 'asSimplexml', $this->beginSerialization(...), $this->mergeDocument(...)],
            [Layout\ProcessorInterface::class, 'asString', $this->beginString(...), $this->serializedUpdates(...)],
            [Merge::class, '__destruct', $this->retireUpdates(...), null],
            [Merge::class, '_validateMergedLayout', $this->beginValidation(...), $this->completeValidation(...)],
            [\Magento\Framework\View\Model\Layout\Update\Validator::class, 'isValid', null, $this->validationResult(...)],
            [Merge::class, 'load', $this->resetPageSelection(...), null],
            [Merge::class, '_loadCache', null, $this->cachedUpdate(...)],
            [ScheduledStructure::class, 'populateWithArray', null, $this->cachedStructure(...)],
            [ScheduledStructure::class, 'setStructureElementData', null, $this->checkScheduledWrite(...)],
            [ScheduledStructure::class, 'setElement', null, $this->checkScheduledWrite(...)],
            [PageBuilder::class, 'readPageLayout', $this->beginPageRead(...), $this->completePageRead(...)],
            [WireframeReader::class, 'read', $this->beginWireframe(...), $this->completeWireframe(...)],
            [BlockReader::class, 'scheduleBlock', $this->beginArgumentSchedule(...), $this->scheduleBlock(...)],
            [BlockReader::class, 'scheduleReference', $this->beginArgumentSchedule(...), $this->scheduleReference(...)],
            [BlockReader::class, 'getActions', null, $this->readActions(...)],
            [BlockReader::class, 'getArguments', null, $this->readArguments(...)],
            [BlockReader::class, 'evaluateArguments', $this->beginReaderArguments(...), $this->completeReaderArguments(...)],
            [MoveReader::class, 'scheduleMove', null, $this->scheduleMove(...)],
            [GeneratorPool::class, 'moveElementInStructure', $this->beginMove(...), $this->completeMove(...)],
            [ScheduledStructure::class, 'setElementToRemoveList', $this->beginRemovalChange(...), $this->completeRemovalChange(...)],
            [ScheduledStructure::class, 'unsetElementFromListToRemove', $this->beginRemovalChange(...), $this->completeRemovalChange(...)],
            [GeneratorPool::class, 'removeElement', $this->beginRemoval(...), $this->completeRemoval(...)],
            [GeneratorPool::class, 'buildStructure', null, $this->finishStructure(...)],
            [Layout::class, 'generateXml', $this->beginXml(...), $this->completeXml(...)],
            [Layout::class, 'generateElements', null, $this->generateElements(...)],
            [XmlConfig::class, 'getNode', null, $this->layoutXmlAccess(...)],
            [XmlConfig::class, 'getXpath', null, $this->layoutXmlAccess(...)],
            [XmlConfig::class, 'setXml', null, $this->layoutXmlAccess(...)],
            [XmlConfig::class, 'setNode', $this->layoutXmlWrite(...), null],
            [XmlConfig::class, 'extend', $this->layoutXmlWrite(...), null],
            [XmlConfig::class, 'applyExtends', $this->layoutXmlWrite(...), null],
            [Layout::class, 'createIsolatedReaderContext', $this->snapshotContext(...), $this->mirrorContext(...)],
            [BlockGenerator::class, '__construct', $this->watchBlockCreation(...), null],
            [BlockGenerator::class, 'createBlock',
                function ($generator, array $params, string $class): void {
                    if ($class === BlockGenerator::class) $this->beginBlockCreation($generator, $params, $class);
                },
                function ($generator, array $params, $block, ?\Throwable $error, string $class): void {
                    if ($class === BlockGenerator::class) $this->completeBlockCreation($generator, $params, $block, $error);
                }],
            [BlockFactory::class, 'createBlock', null, $this->createdByFactory(...)],
            [\Magento\Framework\ObjectManagerInterface::class, 'create', $this->beginBlockObject(...), $this->completeBlockObject(...)],
            [BlockGenerator::class, 'generateBlock', $this->beginBlock(...), $this->completeBlock(...)],
            [BlockGenerator::class, 'evaluateArguments', $this->beginGeneratorArguments(...), $this->evaluatedArguments(...)],
            [Updater::class, 'evaluate', $this->beginArgumentUpdate(...), $this->completeArgumentUpdate(...)],
            [Updater::class, 'applyUpdater', null, $this->appliedArgumentUpdater(...)],
            [BlockGenerator::class, 'getBlockInstance', $this->beginClass(...), $this->constructedClass(...)],
            [DataStructure::class, 'addToParentGroup', null, $this->registeredGroup(...)],
            [DataObject::class, 'setData', null, $this->assignedTtl(...)],
            [BlockGenerator::class, 'generateAction', $this->beginAction(...), $this->completeAction(...)],
            [DataObject::class, 'setData', null, $this->applyArguments(...)],
            [DataObject::class, 'unsetData', null, $this->removeArgumentData(...)],
            [DataObject::class, 'offsetSet', null, $this->removeArgumentData(...)],
            [DataObject::class, 'offsetUnset', null, $this->removeArgumentData(...)],
            [DataObject::class, 'getData', null, $this->consumeArgument(...)],
            [DataObject::class, 'getDataByKey', null, $this->consumeArgument(...)],
            [DataObject::class, 'getDataByPath', null, $this->consumeArgument(...)],
            [DataObject::class, 'offsetGet', null, $this->consumeArgument(...)],
            [Template::class, 'setTemplate', null, $this->assignTemplate(...)],
            [\Magento\Framework\App\PageCache\Kernel::class, 'load', $this->beginPageCache(...), $this->loadedPageCache(...)],
            [AbstractBlock::class, '_loadCache', $this->beginBlockHtml(...), $this->loadBlockHtml(...)],
            [\Magento\Framework\App\CacheInterface::class, 'load', null, $this->loadedBlockCache(...)],
            [\Magento\Framework\Cache\LockGuardedCacheLoader::class, 'lockedLoadData', $this->beginBlockCacheLoader(...), null],
            [AbstractBlock::class, 'toHtml', $this->beginRender(...), $this->completeRender(...)],
            [Template::class, 'fetchView', $this->beginTemplate(...), $this->completeTemplate(...)],
            [Php::class, '__construct', $this->watchTemplateEngine(...), null],
            [\Magento\Framework\View\TemplateEnginePool::class, 'get', null, $this->selectedTemplateEngine(...)],
            [Php::class, 'render',
                function ($engine, array $params, string $class): void {
                    if ($class === Php::class) $this->beginTemplateEngine($engine, $params, $class);
                },
                function ($engine, array $params, $result, ?\Throwable $error, string $class): void {
                    if ($class === Php::class) $this->renderTemplate($engine, $params, $result, $error, $class);
                }],
            ...$this->page->hooks(),
            ...$this->structureCoverage->hooks(),
            ...$this->positions->hooks(),
            ...$this->registry->hooks(),
            ...$this->templateOwnership->hooks(),
            ...$this->engineBeforePlugin->hooks(),
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
        if ($this->ownership->producerDepth($merge, 'getFileLayoutUpdatesXml') === 0) {
            foreach (debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 8) as $frame) {
                if (($frame['class'] ?? null) === Merge::class && ($frame['function'] ?? null) === 'getFileLayoutUpdatesXml') {
                    $this->errors['Missing native layout package getter hook evidence'] = true;
                }
            }
        }
        $state['package'] = ['root' => dom_import_simplexml($xml), 'entries' => $entries, 'replacements' => $replacements,
            'eventObserved' => false, 'revoked' => !$this->ownership->producerTrusted($merge, 'getFileLayoutUpdatesXml')];
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
            if (!empty($package['revoked'])) {
                $this->revokeSources([$source], $this->themeContext($merge), true);
                $source = [];
            }
            $replaced = empty($package['revoked']) ? ($package['replacements'][$entry->getNodePath()] ?? []) : [];
            if (isset($source[0]['ids']['file-override'])) {
                $this->event($source[0]['ids']['file-override'], $replaced
                    ? 'layout-file-override-selected' : 'layout-file-override-unconfirmed', $this->themeContext($merge));
            }
            if ($replaced) {
                $context = $this->themeContext($merge);
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
                $updates[] = ['handle' => $name, 'id' => $name === $id ? ($candidate['ids']['include'] ?? null) : null,
                    'handleId' => $name === $id ? ($candidate['ids']['include-handle'] ?? null) : null];
            }
        }
        $this->entries[] = ['merge' => $merge, 'updates' => $updates, 'next' => 0];
    }

    private function beginHandle($merge, array $params, string $class): void
    {
        if ($class !== Merge::class) return;
        $source = null;
        $handleSource = null;
        $entry = array_key_last($this->entries);
        $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? [];
        if ($entry !== null && $this->entries[$entry]['merge'] === $merge
            && ($caller['class'] ?? null) === Merge::class && ($caller['function'] ?? null) === '_fetchRecursiveUpdates') {
            $index = $this->entries[$entry]['next']++;
            $candidate = $this->entries[$entry]['updates'][$index] ?? null;
            if ($candidate && $candidate['handle'] === $params[0]) {
                $source = $candidate['id'];
                $handleSource = $candidate['handleId'];
            }
        }
        static $allHandles, $processing;
        $allHandles ??= new \ReflectionProperty(Merge::class, 'allHandles');
        $processing ??= new \ReflectionProperty(Merge::class, 'handleProcessing');
        $state = $allHandles->getValue($merge)[$params[0]] ?? null;
        $effect = $state === null ? null : ($state === $processing->getValue($merge) ? 'cycle' : 'duplicate');
        $this->handles[] = ['merge' => $merge, 'id' => $source, 'handleId' => $handleSource, 'effect' => $effect, 'found' => false];
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
        $context = $this->themeContext($merge);
        $this->event($handle['id'], 'layout-include-' . $effect, $context);
        $this->event($handle['handleId'], 'layout-include-' . $effect, $context);
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
            $targets = empty($package['revoked']) ? ($package['entries'][$entry->getNodePath()] ?? []) : [];
            $state['pending'] = ['hash' => hash('sha256', $params[0]->innerXml()), 'targets' => $targets];
            $this->event($targets[0]['ids']['file-selection'] ?? null, 'layout-file-selected', $this->themeContext($merge));
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

    private function beginValidation($merge, array $params, string $class): void
    {
        if ($class === Merge::class) $this->validating[] = ['merge' => $merge, 'failed' => false];
    }

    private function validationResult($validator, array $params, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->validating);
        if ($index === null || $class !== \Magento\Framework\View\Model\Layout\Update\Validator::class) return;
        $caller = self::nativeCaller($validator, 'isValid');
        if (($caller['class'] ?? null) === Merge::class && ($caller['function'] ?? null) === '_validateMergedLayout'
            && ($error instanceof \Magento\Framework\Config\Dom\ValidationException || $result === false)) {
            $this->validating[$index]['failed'] = true;
        }
    }

    private function completeValidation($merge, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Merge::class) return;
        $frame = array_pop($this->validating);
        if (!$frame['failed'] && !($error instanceof \Magento\Framework\Config\Dom\ValidationException)) return;
        $this->healthy = true;
        $this->limitations[$error ? 'layout-validation-failed' : 'layout-validation-warning'] = true;
        if (!$error) return;
        $context = $this->themeContext($merge);
        $updates = self::updates($merge);
        foreach ($this->merges[$merge]['updates'] ?? [] as $index => $source) {
            if (!isset($updates[$index]) || $source['hash'] !== hash('sha256', $updates[$index])) continue;
            $this->sourceTrace = true;
            foreach ($source['targets'] as $target) {
                foreach ($target['ids'] as $id) $this->event($id, 'layout-validation-failed', $context);
            }
        }
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
        $this->positions->reset($structure);
        $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? [];
        if (($caller['class'] ?? null) === Layout::class && ($caller['function'] ?? null) === 'generateElements') {
            $this->limitations['scheduled-layout-cache'] = true;
        }
    }

    private function beginPageRead($builder, array $params, string $class): void
    {
        if ($class === PageBuilder::class) {
            $method = new \ReflectionMethod($builder, 'getPageLayout');
            static $layoutProperty;
            $layoutProperty ??= new \ReflectionProperty(Layout\Builder::class, 'layout');
            $merge = self::layoutUpdate($layoutProperty->getValue($builder));
            $selection = $merge instanceof Merge ? ($this->merges[$merge]['pageLayout'] ?? null) : null;
            if ($selection !== null) $selection['confirmed'] = false;
            $this->pageBuilders[] = ['builder' => $builder, 'selection' => $selection,
                'native' => $method->getDeclaringClass()->getName() === PageBuilder::class];
        }
    }

    private function completePageRead($builder, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class === PageBuilder::class) array_pop($this->pageBuilders);
    }

    private function readSelection(Merge $merge, $result, bool $trusted, ?string $nativeSignature): void
    {
        $frame = array_key_last($this->pageBuilders);
        if ($frame === null || !$this->pageBuilders[$frame]['native']) return;
        $selection = $this->merges[$merge]['pageLayout'] ?? null;
        $caller = LayoutXmlOwnership::caller($merge, 'getPageLayout');
        if (!$selection || ($caller['class'] ?? null) !== PageBuilder::class || ($caller['function'] ?? null) !== 'getPageLayout') return;
        if (!is_string($result) || strlen($result) > 4096) {
            $this->event($selection['id'], 'layout-wireframe-origin-unconfirmed', $this->themeContext($merge));
            return;
        }
        $selection['confirmed'] = $trusted && LayoutSelectionOwnership::signature($selection['name']) === $nativeSignature;
        $selection['name'] = $result;
        $this->pageBuilders[$frame]['selection'] = $selection;
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
        $this->wireframes[$index]['context'] = $this->themeContext($merge);
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
        if ($error) return;
        $caller = self::nativeCaller($merge, 'addUpdate');
        $updates = self::updates($merge);
        $index = array_key_last($updates);
        $appended = count($updates) === $count + 1 && $updates[$index] === $params[0];
        if ($appended && ($caller['class'] ?? null) === Merge::class
            && ($caller['function'] ?? null) === '_fetchDbLayoutUpdates') {
            $this->limitations['layout-database-update'] = true;
        }
        if ($appended && ($caller['class'] ?? null) === \Magento\Cms\Helper\Page::class
            && ($caller['function'] ?? null) === 'prepareResultPage') {
            $this->limitations['layout-cms-update'] = true;
        }
        if ($appended && (($caller['class'] ?? null) !== Merge::class
            || !in_array($caller['function'] ?? null, ['_fetchPackageLayoutUpdates', '_fetchDbLayoutUpdates', 'load'], true))) {
            $this->limitations['layout-programmatic-update'] = true;
        }
        if (!isset($this->merges[$merge]['pending'])) return;
        if (($caller['class'] ?? null) !== Merge::class || ($caller['function'] ?? null) !== '_fetchPackageLayoutUpdates') return;
        $state = $this->merges[$merge];
        $pending = $state['pending'];
        unset($state['pending']);
        if ($appended && $pending['hash'] === hash('sha256', $params[0])) {
            $state['updates'][$index] = $pending;
        }
        $this->merges[$merge] = $state;
    }

    private static function mergeTheme(Merge $merge)
    {
        static $property;
        $property ??= new \ReflectionProperty(Merge::class, 'theme');
        return $property->getValue($merge);
    }

    private function observeTheme($theme, array $params, $value, ?\Throwable $error, string $class, string $method): void
    {
        $caller = LayoutXmlOwnership::caller($theme, $method, false);
        $consumer = (($caller['class'] ?? null) === Merge::class && ($caller['function'] ?? null) === 'generateCacheId')
            || (($caller['function'] ?? null) === 'getFiles' && isset(self::THEME_READERS[$caller['class'] ?? '']));
        if (!$consumer) return;
        $context = $this->themeState($theme);
        if ($context === null) return;
        $key = $method === 'getArea' ? 'area' : 'theme';
        $context[$key . 'Observed'] = true;
        $context[$key] = !$error && is_string($value) && $value !== '' && strlen($value) <= 1024 ? $value : null;
        $this->themeContexts[$theme] = $context;
    }

    private function themeState(object $theme): ?array
    {
        if (!isset($this->themeContexts[$theme]) && count($this->themeContexts) >= 256) {
            $this->errors['Layout theme context observations exceeded 256 themes'] = true;
            return null;
        }
        return $this->themeContexts[$theme] ?? [];
    }

    private function expectTheme($consumer, array $params, string $class): void
    {
        if (in_array($class, [\Magento\Framework\View\File\Collector\Override\Base::class,
            \Magento\Framework\View\File\Collector\Override\ThemeModular::class], true)) return;
        $key = $class === Merge::class ? 'area' : (self::THEME_READERS[$class] ?? null);
        if ($key === null) return;
        $theme = $class === Merge::class ? self::mergeTheme($consumer) : ($params[0] ?? null);
        if (!is_object($theme)) return;
        $context = $this->themeState($theme);
        if ($context === null) return;
        $context[$key . 'Expected'] = true;
        $this->themeContexts[$theme] = $context;
    }

    private function themeContext(Merge $merge): ?array
    {
        $theme = self::mergeTheme($merge);
        $context = is_object($theme) ? ($this->themeContexts[$theme] ?? []) : [];
        foreach (['area', 'theme'] as $key) {
            if (!empty($context[$key . 'Expected']) && empty($context[$key . 'Observed'])) {
                $this->errors['Missing native layout theme context hook evidence'] = true;
                return null;
            }
        }
        if (!isset($context['area'], $context['theme'])) {
            $this->limitations['layout-theme-context-unconfirmed'] = true;
            return null;
        }
        return array_intersect_key($context, ['area' => true, 'theme' => true]);
    }

    private static function updates($merge): array
    {
        static $property;
        $property ??= new \ReflectionProperty(Merge::class, 'updates');
        return $property->getValue($merge);
    }

    private static function nativeCaller(object $subject, string $method): array
    {
        return LayoutXmlOwnership::caller($subject, $method);
    }

    private function startProducer($merge, string $class, string $method, bool $consumer, string $native = Merge::class): bool
    {
        if (!$merge instanceof $native) {
            $this->limitations['layout-processor-unconfirmed'] = true;
            return false;
        }
        $caller = LayoutXmlOwnership::caller($merge, $method, false);
        $delegated = ($caller['class'] ?? null) === get_class($merge) && ($caller['function'] ?? null) === $method;
        $this->ownership->beginProducer($merge, $native, $class, $method, $consumer, $delegated);
        return true;
    }

    private function beginPackageAccess($merge, array $params, string $class): void
    {
        $caller = self::nativeCaller($merge, 'getFileLayoutUpdatesXml');
        $this->startProducer($merge, $class, 'getFileLayoutUpdatesXml', ($caller['class'] ?? null) === Merge::class);
    }

    private function packageAccess($merge, array $params, $xml, ?\Throwable $error, string $class): void
    {
        if (!$merge instanceof Merge) return;
        $proof = $this->ownership->endProducer($merge, 'getFileLayoutUpdatesXml', $error);
        if (!$proof['trusted']) {
            $this->unverifiedProducer($merge, 'getFileLayoutUpdatesXml');
            if ($xml instanceof \SimpleXMLElement || $xml instanceof \DOMNode) $this->observeXmlReceiver($xml, false, false);
        }
    }

    private function unverifiedProducer($merge, string $method): void
    {
        if ($merge instanceof BlockGenerator && $method === 'createBlock') {
            if ($this->ownership->producerDepth($merge, $method) === 1) $this->unconfirmedBlockCreation($merge);
            return;
        }
        if (!$merge instanceof Merge) return;
        if (in_array($method, ['getPageLayout', 'getAllDesignAbstractions'], true)) return;
        if ($method !== 'getFileLayoutUpdatesXml') {
            $this->limitations['layout-serialization-unconfirmed'] = true;
            return;
        }
        $state = $this->merges[$merge] ?? [];
        if (isset($state['package'])) $state['package']['revoked'] = true;
        unset($state['pending']);
        $this->merges[$merge] = $state;
        $this->limitations['mutable-layout-package'] = true;
    }

    private function beginSerialization($merge, array $params, string $class): void
    {
        $caller = self::nativeCaller($merge, 'asSimplexml');
        if (!$this->startProducer($merge, $class, 'asSimplexml',
            in_array($caller['class'] ?? '', [Layout::class, WireframeReader::class, Merge::class], true))) return;
        if ($this->ownership->producerDepth($merge, 'asSimplexml') !== 1) return;
        $state = $this->merges[$merge] ?? [];
        $state['serialization'] = null;
        $state['documentObserved'] = false;
        $this->merges[$merge] = $state;
    }

    private function beginString($merge, array $params, string $class): void
    {
        $this->startProducer($merge, $class, 'asString', true);
    }

    private function serializedUpdates($merge, array $params, $xml, ?\Throwable $error, string $class): void
    {
        if (!$merge instanceof Merge) return;
        $proof = $this->ownership->endProducer($merge, 'asString', $error);
        if (!$proof['final']) return;
        if (!$proof['trusted']) $this->unverifiedProducer($merge, 'asString');
        $caller = self::nativeCaller($merge, 'asString');
        if (($caller['class'] ?? null) !== Merge::class || ($caller['function'] ?? null) !== 'asSimplexml') return;
        $state = $this->merges[$merge] ?? [];
        $state['serialization'] = !$error && $proof['trusted'] && is_string($xml)
            ? hash('sha256', $xml) : false;
        $this->merges[$merge] = $state;
    }

    private function retireUpdates($merge, array $params, string $class): void
    {
        if ($class !== Merge::class) return;
        $state = $this->merges[$merge] ?? [];
        $this->merges[$merge] = ['retired' => $state['updates'] ?? $state['retired'] ?? []];
    }

    private function revokeSources(array $packets, ?array $context, bool $selection = false, string $effect = 'layout-xml-ownership-revoked'): void
    {
        foreach ($packets as $targets) {
            foreach ($targets as $target) {
                foreach ($target['ids'] as $kind => $id) {
                    if (!$selection && in_array($kind, ['file-selection', 'file-override', 'include', 'include-handle', 'wireframe-selection', 'wireframe'], true)) continue;
                    $this->event($id, $effect, $context);
                }
            }
        }
    }

    // Native append order and deduplication determine which source occupies
    // each position. Preserve space for database and programmatic fragments.
    private function mergeDocument($merge, array $params, $xml, ?\Throwable $error, string $class): void
    {
        if (!$merge instanceof Merge) return;
        $proof = $this->ownership->endProducer($merge, 'asSimplexml', $error);
        if (!$proof['final']) return;
        $state = $this->merges[$merge] ?? [];
        $state['documentObserved'] = true;
        $this->merges[$merge] = $state;
        if ($error) return;
        $sources = $state['updates'] ?? [];
        if (!$sources && empty($state['retired'])) return;
        $context = $this->themeContext($merge);
        if ($context === null) return;
        if (!empty($state['retired']) && self::updates($merge)) {
            $this->revokeSources(array_column($state['retired'], 'targets'), $context);
            $this->limitations['layout-updates-reset'] = true;
        }
        if (!$sources) return;
        $parts = self::updates($merge);
        if (array_filter($parts, static fn($part) => !is_string($part))) {
            $this->revokeSources(array_column($sources, 'targets'), $context);
            $this->limitations['layout-nonstring-update'] = true;
            if ($xml instanceof \SimpleXMLElement || $xml instanceof \DOMNode) $this->observeXmlReceiver($xml, false, false);
            return;
        }
        $native = $proof['trusted'] && $xml instanceof Layout\Element
            && LayoutXmlOwnership::nativeMethod($merge, Merge::class, '_loadXmlString');
        if ($native && !isset($state['serialization'])) {
            $this->errors['Missing native layout serialization hook evidence'] = true;
            return;
        }
        if (!$native || ($state['serialization'] ?? false) !== hash('sha256', implode('', $parts))) {
            $this->revokeSources(array_column($sources, 'targets'), $context);
            $this->limitations['layout-serialization-unconfirmed'] = true;
            if ($xml instanceof \SimpleXMLElement || $xml instanceof \DOMNode) $this->observeXmlReceiver($xml, false, false);
            return;
        }
        if (count($this->documents) >= 256) {
            $this->revokeSources(array_column($sources, 'targets'), $context, false, 'layout-origin-limit');
            $this->limitations['layout-document-limit'] = true;
            return;
        }
        $root = dom_import_simplexml($xml);
        $allNodes = $root->getElementsByTagName('*');
        $targets = [];
        $offset = 0;
        foreach ($parts as $index => $part) {
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
        $this->documents[] = ['root' => $root, 'targets' => $targets, 'readerObserved' => false,
            'context' => $context];
    }

    private function layoutXmlAccess($layout, array $params, $result, ?\Throwable $error, string $class, string $method): void
    {
        if ($error || $class !== XmlConfig::class || !$layout instanceof Layout) return;
        if ($method !== 'setXml' && !$result instanceof \SimpleXMLElement
            && !(is_array($result) && array_filter($result, static fn($node) => $node instanceof \SimpleXMLElement))) return;
        $caller = self::nativeCaller($layout, $method);
        if ($method === 'setXml') {
            if (($caller['class'] ?? null) === Layout::class
                && in_array($caller['function'] ?? '', ['generateXml', 'getXml'], true)) return;
        } elseif (in_array($caller['class'] ?? '', [Layout::class, XmlConfig::class], true)
            || str_starts_with($caller['class'] ?? '', __NAMESPACE__ . '\\')) return;
        $this->revokeLayoutXml($layout);
    }

    private function layoutXmlWrite($layout, array $params, string $class): void
    {
        if ($class === XmlConfig::class && $layout instanceof Layout) $this->revokeLayoutXml($layout);
    }

    private function revokeLayoutXml(Layout $layout): void
    {
        static $xml;
        $xml ??= new \ReflectionProperty(XmlConfig::class, '_xml');
        $element = $xml->getValue($layout);
        if (!$element instanceof \SimpleXMLElement) return;
        $this->observeXmlReceiver($element, false, false);
    }

    private function packageEventKnown($element, bool $mark): ?bool
    {
        $node = $element instanceof \DOMNode ? $element : dom_import_simplexml($element);
        foreach ($this->merges as $merge => $state) {
            if (!isset($state['package']) || !$state['package']['root']->isSameNode($node)) continue;
            if ($mark) {
                $state['package']['eventObserved'] = true;
                $this->merges[$merge] = $state;
                return true;
            }
            return $state['package']['eventObserved'];
        }
        return null;
    }

    private function observeXmlReceiver($element, bool $valid, bool $reader): void
    {
        $node = $element instanceof \DOMNode ? $element : dom_import_simplexml($element);
        $root = $node instanceof \DOMDocument ? $node->documentElement : $node->ownerDocument->documentElement;
        if ($valid) {
            if (!$reader) return;
            foreach ($this->documents as &$document) {
                if ($document['root']->isSameNode($root)) $document['readerObserved'] = true;
            }
            unset($document);
            return;
        }
        foreach ($this->merges as $merge => $state) {
            if (isset($state['package']) && $state['package']['root']->isSameNode($root)) {
                $this->unverifiedProducer($merge, 'getFileLayoutUpdatesXml');
            }
        }
        foreach ($this->documents as &$document) {
            if (!$document['root']->isSameNode($root)) continue;
            $this->limitations['mutable-layout-xml'] = true;
            foreach ($document['targets'] as $ids) {
                foreach ($ids as $kind => $id) {
                    if (in_array($kind, ['file-selection', 'include', 'include-handle', 'wireframe-selection', 'wireframe'], true)) continue;
                    $this->event($id, 'layout-xml-ownership-revoked', $document['context']);
                }
            }
            $document['targets'] = [];
        }
        unset($document);
    }

    private function beginArgumentSchedule($reader, array $params, string $class): void
    {
        if ($class !== BlockReader::class) return;
        $data = $params[0]->getStructureElementData($params[1]->getAttribute('name'), []);
        $this->argumentSchedules[] = array_fill_keys(array_keys($data['arguments'] ?? []), true);
    }

    private function scheduleBlock($reader, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== BlockReader::class) return;
        $existing = array_pop($this->argumentSchedules);
        if ($error) {
            [$ids, $context] = $this->origin($params[1]);
            if ($context) $this->event($ids['block'] ?? null, 'layout-block-reading-failed', $context);
            return;
        }
        $this->schedule($params[0], $params[1], true, $existing);
    }

    private function scheduleReference($reader, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== BlockReader::class) return;
        $existing = array_pop($this->argumentSchedules);
        if (!$error && !filter_var($params[1]->getAttribute('remove'), FILTER_VALIDATE_BOOLEAN)) {
            $this->schedule($params[0], $params[1], false, $existing);
        }
    }

    private function schedule($structure, $xml, bool $declaration, array $existing): void
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
        $block['arguments'] = $this->bindArguments($xml, $data['arguments'] ?? [], $block['arguments'] ?? [], $existing);
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
            $origins[] = ['id' => $origin['action'] ?? null, 'methodId' => $origin['action-method'] ?? null, 'arguments' => $arguments];
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
        if ((new \ReflectionMethod($reader, 'evaluateArguments'))->getDeclaringClass()->getName() !== BlockReader::class) return;
        $this->argumentOwnership->supply($arguments, $reader);
        $xml = $params[0];
        $origins = [];
        foreach ($xml->arguments[0]->argument ?? [] as $node) {
            $name = $node->getAttribute('name');
            $origins[$name] = $this->argumentOrigins($node);
            $updaters = [];
            foreach ($node->updater as $updater) {
                [$source, $context] = $this->origin($updater);
                if (isset($source['argument-updater'])) $updaters[] = $source['argument-updater'];
            }
            $parsed = $arguments[$name]['updater'] ?? null;
            if ($parsed === null) {
                foreach ($updaters as $id) $this->event($id, 'layout-updater-ignored', $context);
            } elseif (is_array($parsed) && count($parsed) === count($updaters)) {
                $origins[$name]['updaters'] = array_map(
                    static fn($id, $value) => ['id' => $id, 'input' => self::valueFingerprint($value)],
                    $updaters, array_values($parsed)
                );
            }
        }
        if (array_keys($origins) === array_keys($arguments)) $this->argumentReads[$xml] = $origins;
    }

    private function beginReaderArguments($reader, array $params, string $class): void
    {
        if ($class === BlockReader::class) $this->argumentOwnership->beginBatch($reader, true);
    }

    private function completeReaderArguments($reader, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== BlockReader::class) return;
        $names = $this->argumentOwnership->endBatch($error);
        if ($error || !$names) return;
        $xml = $params[0];
        $origins = $this->argumentReads[$xml] ?? [];
        [, $context] = $this->origin($xml);
        foreach ($names as $name) {
            if ($context !== null) $this->unconfirmedArgument($origins[$name] ?? [], $context);
            $origins[$name] = [];
        }
        $this->argumentReads[$xml] = $origins;
    }

    private function unconfirmedArgument(array $origin, array $context, string $effect = 'layout-argument-origin-unconfirmed'): void
    {
        foreach (self::argumentRootIds($origin) as $id) $this->event($id, $effect, $context);
        foreach ($origin['children'] ?? [] as $child) $this->unconfirmedArgument($child, $context, $effect);
    }

    private function argumentOrigins($node): array
    {
        [$origin] = $this->origin($node);
        $result = isset($origin['argument']) ? ['id' => $origin['argument']] : [];
        if ((string) $node->attributes('http://www.w3.org/2001/XMLSchema-instance')->type !== 'array'
            || isset($node->updater)) return $result;
        $children = [];
        foreach ($node->item as $item) $children[$item->getAttribute('name')] = $this->argumentOrigins($item);
        return [...$result, 'children' => $children];
    }

    private function bindArguments($xml, array $values, array $previous, array $existing): array
    {
        $read = $this->argumentReads[$xml] ?? null;
        unset($this->argumentReads[$xml]);
        if ($read === null) return [];
        return $this->bindArgumentLeaves($read, $values, $previous, $existing);
    }

    private function bindArgumentLeaves(array $read, array $values, array $previous, array $existing): array
    {
        foreach ($read as $name => $origin) {
            $before = $previous[$name] ?? [];
            $entry = ['overridden' => $before['overridden'] ?? [], 'mixed' => $before['mixed'] ?? []];
            if (isset($origin['children']) && isset($values[$name]) && is_array($values[$name])) {
                $nested = isset($existing[$name]) ? array_fill_keys(array_keys($values[$name]), true) : [];
                $entry['children'] = $this->bindArgumentLeaves($origin['children'], $values[$name], $before['children'] ?? [], $nested);
            }
            if (!isset($origin['id']) && array_key_exists($name, $values)) {
                if (isset($entry['children'])) {
                    $entry['mixed'] = [...$entry['mixed'], ...self::argumentRootIds($before)];
                } else {
                    $entry['overridden'] = [...$entry['overridden'], ...self::argumentTreeIds($before)];
                    $entry['mixed'] = [];
                }
            }
            if (isset($origin['id']) && array_key_exists($name, $values)) {
                if (is_scalar($values[$name]) || $values[$name] === null) {
                    $entry['id'] = $origin['id'];
                    $entry['digest'] = self::digest([$values[$name]]);
                    $entry['overridden'] = [...$entry['overridden'], ...self::argumentTreeIds($before)];
                    $entry['mixed'] = [];
                } elseif (!isset($existing[$name])) {
                    $identity = self::valueFingerprint($values[$name]);
                    if ($identity) $entry['pending'] = ['id' => $origin['id'], 'input' => $identity,
                        'updaters' => $origin['updaters'] ?? []];
                    else $entry['limited'] = [$origin['id']];
                } else {
                    $entry['mixed'] = [...$entry['mixed'], ...self::argumentRootIds($before), $origin['id']];
                }
            }
            $entry['overridden'] = array_values(array_unique(array_diff($entry['overridden'], [$origin['id'] ?? null])));
            $entry['mixed'] = array_values(array_unique($entry['mixed']));
            $previous[$name] = array_filter($entry, static fn($value) => $value !== []);
        }
        return $this->matchingArguments($previous, $values);
    }

    private function matchingArguments(array $origins, array $values): array
    {
        $matched = [];
        foreach ($origins as $name => $origin) {
            if (!array_key_exists($name, $values)) continue;
            $value = $values[$name];
            $entry = array_intersect_key($origin, array_flip(['mixed', 'overridden', 'limited']));
            if (isset($origin['children']) && is_array($value)) {
                $entry['children'] = $this->matchingArguments($origin['children'], $value);
            }
            if (isset($origin['digest']) && (is_scalar($value) || $value === null)
                && self::digest([$value]) === $origin['digest']) {
                $entry += array_intersect_key($origin, array_flip(['id', 'digest']));
            }
            if (isset($origin['value']) && self::matchesFingerprint($origin['value'], $value)) {
                $entry += array_intersect_key($origin, array_flip(['id', 'value']));
            }
            if (isset($origin['pending']) && self::matchesFingerprint($origin['pending']['input'], $value)) {
                $entry['pending'] = $origin['pending'];
            }
            $entry = array_filter($entry, static fn($value) => $value !== []);
            if ($entry) $matched[$name] = $entry;
        }
        return $matched;
    }

    private static function argumentTreeIds(array $origin): array
    {
        $ids = [...self::argumentRootIds($origin), ...($origin['mixed'] ?? []),
            ...($origin['overridden'] ?? []), ...($origin['limited'] ?? [])];
        foreach ($origin['children'] ?? [] as $child) $ids = [...$ids, ...self::argumentTreeIds($child)];
        return array_values(array_unique($ids));
    }

    private static function argumentRootIds(array $origin): array
    {
        return array_values(array_filter([$origin['id'] ?? null, $origin['pending']['id'] ?? null]));
    }

    private static function valueFingerprint($value): ?array
    {
        $nodes = 1024;
        $bytes = 65536;
        return self::fingerprintValue($value, $nodes, $bytes, 0);
    }

    private static function fingerprintValue($value, int &$nodes, int &$bytes, int $depth): ?array
    {
        if (--$nodes < 0 || $depth > 32) return null;
        if (is_object($value)) return ['object' => \WeakReference::create($value)];
        if (is_resource($value)) return ['resource' => get_resource_id($value), 'type' => get_resource_type($value)];
        if (is_array($value)) {
            $items = [];
            foreach ($value as $key => $child) {
                $length = is_string($key) ? strlen($key) : 0;
                $bytes -= $length;
                if ($bytes < 0) return null;
                $identity = self::fingerprintValue($child, $nodes, $bytes, $depth + 1);
                if (!$identity) return null;
                $items[] = ['key' => self::digest([$key]), 'bytes' => $length, 'value' => $identity];
            }
            return ['items' => $items];
        }
        if (!is_scalar($value) && $value !== null) return null;
        $length = is_string($value) ? strlen($value) : 0;
        $bytes -= $length;
        return $bytes < 0 ? null : ['digest' => self::digest([$value]), 'bytes' => $length];
    }

    private static function matchesFingerprint(array $identity, $value): bool
    {
        if (isset($identity['object'])) return is_object($value) && $identity['object']->get() === $value;
        if (isset($identity['resource'])) return is_resource($value)
            && $identity['resource'] === get_resource_id($value) && $identity['type'] === get_resource_type($value);
        if (isset($identity['items'])) {
            if (!is_array($value) || count($value) !== count($identity['items'])) return false;
            $index = 0;
            foreach ($value as $key => $child) {
                $item = $identity['items'][$index++];
                if ((is_string($key) ? strlen($key) : 0) !== $item['bytes'] || self::digest([$key]) !== $item['key']
                    || !self::matchesFingerprint($item['value'], $child)) return false;
            }
            return true;
        }
        return (is_scalar($value) || $value === null) && (is_string($value) ? strlen($value) : 0) === $identity['bytes']
            && self::digest([$value]) === $identity['digest'];
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
                if ($document['targets'] && !$document['readerObserved']) {
                    $this->errors['Missing native layout reader ownership hook evidence'] = true;
                    return [[], $document['context']];
                }
                return [$document['targets'][$node->getNodePath()] ?? [], $document['context']];
            }
        }
        return [[], null];
    }

    private function packageOrigin(Merge $merge, \SimpleXMLElement $xml): array
    {
        $package = $this->merges[$merge]['package'] ?? null;
        if (!$package || !empty($package['revoked'])) return [[], null];
        $node = dom_import_simplexml($xml);
        if (!$node->ownerDocument->documentElement->isSameNode($package['root'])) return [[], null];
        return [$package['entries'][$node->getNodePath()][0]['ids'] ?? [], $this->themeContext($merge)];
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

    private static function layoutUpdate($layout)
    {
        static $property;
        $property ??= new \ReflectionProperty(Layout::class, '_update');
        return $property->getValue($layout);
    }

    private function beginXml($layout, array $params, string $class): void
    {
        if ($class !== Layout::class) return;
        $merge = self::layoutUpdate($layout);
        if ($merge instanceof Merge) {
            $state = $this->merges[$merge] ?? [];
            $state['documentObserved'] = false;
            $this->merges[$merge] = $state;
        }
        $context = self::readerContext($layout);
        if ($context !== null) {
            $structure = $context->getScheduledStructure();
            unset($this->structures[$structure], $this->moves[$structure], $this->removals[$structure]);
            $this->page->reset($context->getPageConfigStructure());
            $this->structureCoverage->reset($structure);
            $this->positions->reset($structure);
        }
    }

    private function completeXml($layout, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== Layout::class) return;
        $merge = self::layoutUpdate($layout);
        $state = $merge instanceof Merge ? ($this->merges[$merge] ?? []) : [];
        if (!empty($state['updates']) && empty($state['documentObserved'])) {
            $this->errors['Missing native layout document hook evidence'] = true;
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
            if ($document['targets'] && $node->isSameNode($document['root']) && (isset($this->structures[$context->getScheduledStructure()])
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
            $this->page->snapshot($context->getPageConfigStructure()), $this->structureCoverage->snapshot($source), $this->positions->snapshot($source)];
    }

    private function mirrorContext($layout, array $params, $context, ?\Throwable $error, string $class): void
    {
        if ($class !== Layout::class) return;
        [$blocks, $moves, $removals, $page, $containers, $positions] = array_pop($this->contexts);
        if ($error) return;
        $schedule = $context->getScheduledStructure();
        if ($blocks) $this->structures[$schedule] = $blocks;
        if ($moves) $this->moves[$schedule] = $moves;
        if ($removals) $this->removals[$schedule] = $removals;
        $this->page->restore($context->getPageConfigStructure(), $page);
        $this->structureCoverage->restore($schedule, $containers);
        $this->positions->restore($schedule, $positions);
    }

    private function watchBlockCreation($generator): void
    {
        $this->ownership->watchProducer($generator, BlockGenerator::class, 'createBlock',
            $this->beginBlockCreation(...), $this->completeBlockCreation(...));
    }

    private function beginBlockCreation($generator, array $params, string $class): void
    {
        $index = array_key_last($this->generating);
        $caller = self::nativeCaller($generator, 'createBlock');
        $consumer = ($caller['class'] ?? null) === BlockGenerator::class && ($caller['function'] ?? null) === 'generateBlock';
        if ($index !== null && $this->ownership->producerDepth($generator, 'createBlock') === 0 && $consumer) {
            $this->generating[$index]['creating'] = true;
            $this->generating[$index]['creationObserved'] = true;
        }
        $this->startProducer($generator, $class, 'createBlock', $consumer, BlockGenerator::class);
        if ($index !== null && $consumer && $class === BlockGenerator::class
            && $this->ownership->producerTrusted($generator, 'createBlock')) $this->generating[$index]['creationTrusted'] = true;
        if ($consumer && $class === BlockGenerator::class && !$this->ownership->producerTrusted($generator, 'createBlock')) {
            $this->unconfirmedBlockCreation($generator);
        }
    }

    private function completeBlockCreation($generator, array $params, $block, ?\Throwable $error): void
    {
        $proof = $this->ownership->endProducer($generator, 'createBlock', $error);
        if (!$proof['final']) return;
        if (!$proof['trusted']) $this->unconfirmedBlockCreation($generator);
        $index = array_key_last($this->generating);
        if ($index !== null && $this->generating[$index]['subject'] === $generator) $this->generating[$index]['creating'] = false;
    }

    private function unconfirmedBlockCreation($generator): void
    {
        $index = array_key_last($this->generating);
        if ($index === null || $this->generating[$index]['subject'] !== $generator || !$this->generating[$index]['creating']) return;
        $frame = $this->generating[$index];
        if (!$frame['creationUnconfirmed'] && isset($frame['source']['context'])) {
            foreach ($frame['source']['arguments'] ?? [] as $origin) {
                $this->unconfirmedArgument($origin, $frame['source']['context'], 'layout-argument-application-unconfirmed');
            }
        }
        $this->generating[$index]['creationUnconfirmed'] = true;
        $this->generating[$index]['class'] = null;
        $this->generating[$index]['arguments'] = [];
        $this->generating[$index]['applied'] = [];
    }

    private static function nativeBlockFactory(BlockFactory $factory): bool
    {
        if (!LayoutXmlOwnership::nativeMethod($factory, BlockFactory::class, 'createBlock')
            || (new \ReflectionMethod($factory, 'createBlock'))->getDeclaringClass()->getName() !== BlockFactory::class) return false;
        $manager = (new \ReflectionProperty(BlockFactory::class, 'objectManager'))->getValue($factory);
        return self::nativeObjectManager($manager);
    }

    private static function nativeObjectManager(object $manager): bool
    {
        if (!LayoutXmlOwnership::nativeMethod($manager, ObjectManager::class, 'create')) return false;
        $nativeManager = ObjectManager::class;
        $objectFactory = (new \ReflectionProperty($nativeManager, '_factory'))->getValue($manager);
        $config = (new \ReflectionProperty($nativeManager, '_config'))->getValue($manager);
        $factories = [\Magento\Framework\ObjectManager\Factory\Dynamic\Developer::class,
            \Magento\Framework\ObjectManager\Factory\Dynamic\Production::class, \Magento\Framework\ObjectManager\Factory\Compiled::class];
        $configs = [\Magento\Framework\Interception\ObjectManager\Config\Developer::class,
            \Magento\Framework\Interception\ObjectManager\Config\Compiled::class,
            \Magento\Framework\ObjectManager\Config\Compiled::class, \Magento\Framework\ObjectManager\Config\Config::class];
        return in_array(get_class($objectFactory), $factories, true) && in_array(get_class($config), $configs, true);
    }

    private function beginBlockObject($manager, array $params, string $class): void
    {
        if (!$this->constructing && !$this->blockObjectCreations && !$this->blockObjectOverflow) return;
        if ($this->blockObjectOverflow || count($this->blockObjectCreations) >= 256) {
            $this->blockObjectOverflow++;
            $this->errors['Layout block object creation nesting exceeded 256 calls'] = true;
            return;
        }
        $index = $this->constructing[array_key_last($this->constructing)] ?? null;
        $entry = null;
        if ($index !== null && $index === array_key_last($this->generating)) {
            $frame = $this->generating[$index];
            $factory = $frame['factory'];
            $caller = self::nativeCaller($manager, 'create');
            $factoryCaller = self::nativeCaller($factory, 'createBlock');
            if (($caller['object'] ?? null) === $factory && ($caller['class'] ?? null) === BlockFactory::class
                && ($caller['function'] ?? null) === 'createBlock') $this->generating[$index]['managerObserved'] = true;
            if ($class === ObjectManager::class && ($caller['object'] ?? null) === $factory && ($caller['class'] ?? null) === BlockFactory::class
                && ($caller['function'] ?? null) === 'createBlock'
                && ($factoryCaller['class'] ?? null) === BlockGenerator::class && ($factoryCaller['function'] ?? null) === 'getBlockInstance'
                && LayoutXmlOwnership::nativeMethod($factory, BlockFactory::class, 'createBlock')
                && self::nativeObjectManager($manager) && ($params[0] ?? null) === ltrim($frame['source']['attributes']['class']['value'], '\\')) {
                $entry = $index;
            }
        }
        $this->blockObjectCreations[] = $entry;
    }

    private function completeBlockObject($manager, array $params, $block, ?\Throwable $error): void
    {
        if ($this->blockObjectOverflow) {
            $this->blockObjectOverflow--;
            return;
        }
        if (!$this->blockObjectCreations) return;
        $index = array_pop($this->blockObjectCreations);
        if (!$error && $index !== null && $index === array_key_last($this->generating) && $block instanceof AbstractBlock) {
            $this->generating[$index]['managerBlock'] = $block;
        }
    }

    private function createdByFactory($factory, array $params, $block, ?\Throwable $error, string $class): void
    {
        $index = $this->constructing[array_key_last($this->constructing)] ?? null;
        if ($class !== BlockFactory::class || $index === null || $index !== array_key_last($this->generating)) return;
        $this->generating[$index]['factoryObserved'] = true;
        if (!$error && $block instanceof AbstractBlock && !$this->generating[$index]['managerObserved']) {
            $this->errors['Missing native block object manager hook evidence'] = true;
        }
        $caller = self::nativeCaller($factory, 'createBlock');
        if (!$error && $block instanceof AbstractBlock && $this->generating[$index]['managerBlock'] === $block
            && ($caller['class'] ?? null) === BlockGenerator::class && ($caller['function'] ?? null) === 'getBlockInstance') {
            $this->generating[$index]['factoryBlock'] = $block;
        }
    }

    private function beginBlock($generator, array $params, string $class): void
    {
        if ($class !== BlockGenerator::class) return;
        $this->watchBlockCreation($generator);
        $this->generating[] = ['source' => $this->structures[$params[0]][$params[2]] ?? [], 'selected' => null,
            'generator' => get_class($generator), 'subject' => $generator, 'creating' => false,
            'creationObserved' => false, 'creationTrusted' => false, 'creationUnconfirmed' => false,
            'factoryObserved' => false, 'factoryBlock' => null, 'factory' => null, 'managerBlock' => null, 'managerObserved' => false, 'applied' => [], 'arguments' => [], 'evaluationObserved' => false,
            'name' => $params[2], 'class' => null, 'ttl' => null, 'group' => false];
    }

    private function beginArgumentUpdate($interpreter, array $params, string $class): void
    {
        if ($class !== Updater::class) return;
        $frame = null;
        $index = array_key_last($this->generating);
        $caller = self::nativeCaller($interpreter, 'evaluate');
        if ($index !== null && ($caller['class'] ?? null) === BlockGenerator::class
            && ($caller['function'] ?? null) === 'evaluateArguments') {
            $source = $this->generating[$index]['source'];
            $candidates = [];
            foreach ($source['arguments'] ?? [] as $origin) {
                $pending = $origin['pending'] ?? null;
                if ($pending && $pending['updaters'] && self::matchesFingerprint($pending['input'], $params[0])) {
                    $candidates[] = $pending['updaters'];
                }
            }
            if (count($candidates) === 1) $frame = ['sources' => $candidates[0], 'next' => 0, 'context' => $source['context']];
            elseif ($candidates) {
                foreach ($candidates as $candidate) {
                    foreach ($candidate as $origin) $this->event($origin['id'], 'layout-updater-ambiguous', $source['context']);
                }
            }
        }
        $this->updatingArguments[] = $frame;
    }

    private function appliedArgumentUpdater($interpreter, array $params, $value, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->updatingArguments);
        if ($class !== Updater::class || $index === null || !$this->updatingArguments[$index]) return;
        $caller = self::nativeCaller($interpreter, 'applyUpdater');
        if (($caller['class'] ?? null) !== Updater::class || ($caller['function'] ?? null) !== 'evaluate') return;
        $frame = $this->updatingArguments[$index];
        $origin = $frame['sources'][$frame['next']] ?? null;
        $this->updatingArguments[$index]['next']++;
        if ($origin && $origin['input'] && self::matchesFingerprint($origin['input'], $params[1])) {
            $this->event($origin['id'], $error ? 'layout-updater-failed' : 'layout-updater-executed', $frame['context']);
        }
    }

    private function completeArgumentUpdate($interpreter, array $params, $value, ?\Throwable $error, string $class): void
    {
        if ($class === Updater::class) array_pop($this->updatingArguments);
    }

    private function beginGeneratorArguments($generator, array $params, string $class): void
    {
        if ($class === BlockGenerator::class) $this->argumentOwnership->beginBatch($generator, false, $params[0]);
    }

    private function evaluatedArguments($generator, array $params, $values, ?\Throwable $error, string $class): void
    {
        if ($class !== BlockGenerator::class) return;
        $names = $this->argumentOwnership->endBatch($error);
        $caller = self::nativeCaller($generator, 'evaluateArguments');
        if (($caller['class'] ?? null) === BlockGenerator::class && ($caller['function'] ?? null) === 'generateAction') {
            $action = array_key_last($this->actionEvaluations);
            if ($this->actionEvaluationOverflow) return;
            if ($action === null) $this->errors['Missing native layout action hook evidence'] = true;
            else $this->actionEvaluations[$action] = ['observed' => true, 'unconfirmed' => $names];
            return;
        }
        $index = array_key_last($this->generating);
        if ($error || $class !== BlockGenerator::class || $index === null) return;
        if (($caller['class'] ?? null) !== BlockGenerator::class || ($caller['function'] ?? null) !== 'generateBlock'
            || (new \ReflectionMethod($generator, 'evaluateArguments'))->getDeclaringClass()->getName() !== BlockGenerator::class) return;
        $this->generating[$index]['evaluationObserved'] = true;
        $frame = $this->generating[$index];
        foreach ($names as $name) {
            if (isset($frame['source']['context'])) $this->unconfirmedArgument($frame['source']['arguments'][$name] ?? [], $frame['source']['context']);
            unset($frame['source']['arguments'][$name]);
        }
        $origins = $this->resolveArgumentValues($frame['source']['arguments'] ?? [], $params[0], $values);
        $this->generating[$index]['arguments'] = $origins;
        if (!empty($frame['source']['context'])) $this->argumentEvaluationEvents($origins, $frame['source']['context']);
    }

    private function resolveArgumentValues(array $origins, array $input, array $values): array
    {
        $validated = $this->matchingArguments($origins, $input);
        $resolved = $this->matchingArguments($validated, $values);
        foreach ($validated as $name => $origin) {
            if (!array_key_exists($name, $values)) continue;
            if (isset($origin['pending'])) {
                $identity = self::valueFingerprint($values[$name]);
                $resolved[$name]['evaluated'] = [$origin['pending']['id']];
                if ($identity) {
                    $resolved[$name]['id'] = $origin['pending']['id'];
                    $resolved[$name]['value'] = $identity;
                } else {
                    $resolved[$name]['limited'][] = $origin['pending']['id'];
                }
            }
            if (isset($origin['children']) && isset($input[$name]) && is_array($input[$name]) && is_array($values[$name])) {
                $resolved[$name]['children'] = $this->resolveArgumentValues($origin['children'], $input[$name], $values[$name]);
            }
        }
        return $resolved;
    }

    private function argumentEvaluationEvents(array $origins, array $context): void
    {
        foreach ($origins as $origin) {
            foreach (array_unique([...self::argumentRootIds($origin), ...($origin['evaluated'] ?? [])]) as $id) {
                $this->event($id, 'layout-argument-evaluated', $context);
            }
            foreach ($origin['mixed'] ?? [] as $id) $this->event($id, 'layout-argument-mixed-origin', $context);
            foreach ($origin['overridden'] ?? [] as $id) $this->event($id, 'layout-argument-overridden', $context);
            foreach ($origin['limited'] ?? [] as $id) $this->event($id, 'layout-argument-identity-unconfirmed', $context);
            if (isset($origin['children'])) $this->argumentEvaluationEvents($origin['children'], $context);
        }
    }

    private function beginClass($generator, array $params, string $class): void
    {
        if ($class !== BlockGenerator::class) return;
        $index = array_key_last($this->generating);
        $origin = $index === null ? null : ($this->generating[$index]['source']['attributes']['class'] ?? null);
        $caller = self::nativeCaller($generator, 'getBlockInstance');
        $eligible = $origin && $origin['value'] !== '' && $origin['value'] === $params[0]
            && ($caller['class'] ?? null) === BlockGenerator::class && ($caller['function'] ?? null) === 'createBlock';
        if ($eligible) {
            $factory = (new \ReflectionProperty(BlockGenerator::class, 'blockFactory'))->getValue($generator);
            $this->generating[$index]['factory'] = $factory;
            $this->generating[$index]['factoryExpected'] = self::nativeBlockFactory($factory);
        }
        $this->constructing[] = $eligible ? $index : null;
    }

    private function constructedClass($generator, array $params, $block, ?\Throwable $error, string $class): void
    {
        if ($class !== BlockGenerator::class) return;
        $index = array_pop($this->constructing);
        if (!$error && $index !== null && $index === array_key_last($this->generating) && $block instanceof AbstractBlock) {
            if ((!empty($this->generating[$index]['factoryExpected']) || $this->generating[$index]['managerBlock'] !== null)
                && !$this->generating[$index]['factoryObserved']) {
                $this->errors['Missing native block factory hook evidence'] = true;
            }
            if ($this->generating[$index]['creationTrusted'] && !$this->generating[$index]['creationUnconfirmed']
                && $this->generating[$index]['factoryBlock'] === $block) {
                $this->generating[$index]['class'] = $block;
            }
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
        if ($error || $class !== DataObject::class || !$block instanceof AbstractBlock) return;
        $key = $params[0] ?? '';
        $this->invalidateArgumentData($block, is_array($key) ? null : [$key]);
        if ($index === null) return;
        $frame = $this->generating[$index];
        $origins = $frame['arguments'];
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
        $values = is_array($key) ? $key : [$key => $params[1] ?? null];
        $matched = $this->matchingArguments($origins, $values);
        foreach ($this->appliedArgumentIds($matched) as $id) {
            $this->generating[$index]['applied'][$id] = $block;
        }
        if ($matched) {
            $binding = $this->argumentBindings[$block] ?? ['origins' => []];
            $binding['origins'] = array_replace($binding['origins'], $matched);
            $binding['context'] = $frame['source']['context'];
            $this->argumentBindings[$block] = $binding;
        }
    }

    private function invalidateArgumentData(AbstractBlock $block, ?array $keys): void
    {
        $binding = $this->argumentBindings[$block] ?? null;
        if (!$binding) return;
        if ($keys !== null) $keys = array_map(self::dataKey(...), $keys);
        $removed = $keys === null ? $binding['origins'] : array_intersect_key($binding['origins'], array_fill_keys($keys, true));
        foreach ($this->appliedArgumentIds($removed) as $id) $this->event($id, 'layout-argument-replaced', $binding['context']);
        $binding['origins'] = array_diff_key($binding['origins'], $removed);
        $this->argumentBindings[$block] = $binding;
    }

    private static function dataKey($key): string|int
    {
        return is_bool($key) || is_float($key) || is_resource($key) ? (int) $key : ($key ?? '');
    }

    private function removeArgumentData($block, array $params, $result, ?\Throwable $error, string $class, string $function): void
    {
        if ($error || $class !== DataObject::class || !$block instanceof AbstractBlock) return;
        $key = $params[0] ?? null;
        if ($function === 'unsetData') {
            // Arrays delegate to unsetData once per key inside the native method.
            if (is_array($key) || ($key !== null && !is_string($key))) return;
            $this->invalidateArgumentData($block, $key === null ? null : [$key]);
            return;
        }
        $this->invalidateArgumentData($block, [self::dataKey($key)]);
    }

    private function consumeArgument($block, array $params, $value, ?\Throwable $error, string $class, string $function): void
    {
        if ($error || $class !== DataObject::class || !isset($this->blocks[$block], $this->argumentBindings[$block])) return;
        $key = $params[0] ?? null;
        if (!is_scalar($key) && $key !== null) return;
        if ($function === 'getData' && ($key === null || $key === '')) return;
        $binding = $this->argumentBindings[$block];
        $origins = $binding['origins'];
        static $data;
        $data ??= new \ReflectionProperty(DataObject::class, '_data');
        $values = $data->getValue($block);
        $path = $function === 'getDataByPath'
            || ($function === 'getData' && !isset($values[$key]) && str_contains((string) $key, '/'));
        if ($path && $value === null) return;
        $keys = $path ? explode('/', (string) $key) : [self::dataKey($key)];
        $origin = null;
        foreach ($keys as $part) {
            if (!is_array($values) || !array_key_exists($part, $values)) return;
            $values = $values[$part];
            $origin = $origins[$part] ?? null;
            $origins = $origin['children'] ?? [];
        }
        if ($function === 'getData' && ($params[1] ?? null) !== null) {
            // Native array projections consume one existing non-null member.
            // String projections split the original value at native EOLs.
            if ($value === null) return;
            if (is_array($values)) {
                $origin = $origins[self::dataKey($params[1])] ?? null;
            } elseif (is_string($values)) {
                $value = $values;
            } else return;
        }
        $matched = isset($origin['digest']) && (is_scalar($value) || $value === null)
            && self::digest([$value]) === $origin['digest'];
        $matched = $matched || (isset($origin['value']) && self::matchesFingerprint($origin['value'], $value));
        if (isset($origin['id']) && $matched) {
            $this->event($origin['id'], 'layout-argument-read', $binding['context']);
        }
    }

    private function completeBlock($generator, array $params, $block, ?\Throwable $error, string $class): void
    {
        if ($class !== BlockGenerator::class) return;
        $frame = array_pop($this->generating);
        if (!$error && $block instanceof AbstractBlock) {
            $this->blockRendering->expectRegistration($generator, $params[2]);
            $this->blockRendering->generated($block, $params[2], null, []);
        }
        if (empty($frame['source']['context'])) return;
        if ($error) {
            $this->event($frame['source']['block'] ?? null, 'layout-block-generation-failed', $frame['source']['context']);
            return;
        }
        if (!$block instanceof AbstractBlock) return;
        if (!$frame['creationObserved'] && LayoutXmlOwnership::nativeMethod($generator, BlockGenerator::class, 'createBlock')) {
            $this->errors['Missing native block creation hook evidence'] = true;
        }
        $source = $frame['source'];
        if (!$frame['creationTrusted'] && !$frame['creationUnconfirmed']) {
            foreach ($source['arguments'] ?? [] as $origin) {
                $this->unconfirmedArgument($origin, $source['context'], 'layout-argument-application-unconfirmed');
            }
        }
        if (!empty($source['arguments']) && !$frame['evaluationObserved']) {
            $this->errors['Missing native layout generator argument batch hook evidence'] = true;
        }
        $context = $source['context'];
        $blockId = $source['block'] ?? null;
        $templateId = $frame['selected'] === $block ? ($source['template'] ?? null) : null;
        foreach (array_keys($source['overridden'] ?? []) as $previous) {
            if ($previous !== $templateId) $this->event($previous, 'layout-template-overridden', $context);
        }
        $this->event($blockId, 'layout-block-created', $context);
        $this->blockRendering->generated($block, $params[2], $blockId, $context);
        $this->event($templateId, 'layout-template-selected', $context);
        foreach (array_keys($source['overriddenAttributes'] ?? []) as $id) {
            $this->event($id, 'layout-block-attribute-overridden', $context);
        }
        foreach (['class', 'ttl'] as $attribute) {
            if ($frame[$attribute] === $block) {
                $this->event($source['attributes'][$attribute]['id'], 'layout-block-' . $attribute . '-applied', $context);
            }
        }
        if (isset($source['attributes']['class']) && $frame['class'] !== $block) {
            $this->event($source['attributes']['class']['id'], empty($source['attributes']['class']['value'])
                ? 'layout-block-class-defaulted' : 'layout-block-class-origin-unconfirmed', $context);
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
                'id' => $origins[$index]['id'], 'methodId' => $origins[$index]['methodId'] ?? null,
                'arguments' => $origins[$index]['arguments'] ?? []];
        }
        return $calls;
    }

    private function beginAction($generator, array $params, string $class): void
    {
        if ($class !== BlockGenerator::class) return;
        if ($this->actionEvaluationOverflow || count($this->actionEvaluations) >= 256) {
            $this->actionEvaluationOverflow++;
            $this->errors['Layout action evaluation nesting exceeded 256 calls'] = true;
            return;
        }
        $this->actionEvaluations[] = ['observed' => false, 'unconfirmed' => []];
    }

    private function completeAction($generator, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== BlockGenerator::class) return;
        if ($this->actionEvaluationOverflow) {
            $this->actionEvaluationOverflow--;
            return;
        }
        $evaluation = array_pop($this->actionEvaluations);
        if ($error) return;
        [$block, $method, $arguments] = $params;
        if (empty($this->blocks[$block]['actions'])) return;
        $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? [];
        if (($caller['class'] ?? null) !== BlockGenerator::class || ($caller['function'] ?? null) !== 'process') return;
        if ((new \ReflectionMethod($generator, 'generateAction'))->getDeclaringClass()->getName() !== BlockGenerator::class) return;
        $state = $this->blocks[$block];
        $origins = $state['actions'][self::digest([$method, $arguments])] ?? [];
        if ($origins && empty($evaluation['observed'])) $this->errors['Missing native action argument evaluation hook evidence'] = true;
        $effect = count($origins) === 1 ? 'layout-action-executed' : 'layout-action-ambiguous';
        foreach ($origins as $origin) {
            $this->event($origin['id'], $effect, $state['context']);
            $this->event($origin['methodId'] ?? null, $effect, $state['context']);
            foreach ($origin['arguments'] as $position => $id) {
                $name = array_keys($arguments)[$position] ?? null;
                $argumentEffect = in_array($name, $evaluation['unconfirmed'] ?? [], true) ? 'layout-argument-origin-unconfirmed'
                    : (count($origins) === 1 ? 'layout-action-argument-applied' : 'layout-action-argument-ambiguous');
                $this->event($id, $argumentEffect, $state['context']);
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
        if ($this->blockRenderOverflow || count($this->blockRenders) >= 256) {
            $this->blockRenderOverflow++;
            $this->errors['Block render nesting exceeded 256 calls'] = true;
            return;
        }
        $this->blockRenders[] = ['block' => $block, 'origin' => $this->blockRendering->origin($block)];
        if ($block instanceof Template) $this->templateOwnership->watch($block, isset($this->blocks[$block]));
        if (isset($this->blocks[$block])) {
            $state = $this->blocks[$block];
            unset($state['executed'], $state['html']);
            $this->blocks[$block] = $state;
        }
    }

    private function beginPageCache($kernel, array $params, string $class): void
    {
        if ($class !== \Magento\Framework\App\PageCache\Kernel::class) return;
        if (count($this->loadingPages) >= 256 || $this->loadingPagesOverflow) {
            $this->loadingPagesOverflow++;
            $this->errors['Layout full-page cache nesting exceeded 256 calls'] = true;
            return;
        }
        $this->loadingPages[] = $kernel;
    }

    private function loadedPageCache($kernel, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== \Magento\Framework\App\PageCache\Kernel::class) return;
        if ($this->loadingPagesOverflow) { $this->loadingPagesOverflow--; return; }
        if (array_pop($this->loadingPages) !== $kernel) {
            $this->errors['Unbalanced full-page cache hook evidence'] = true;
            return;
        }
        if ($error) return;
        $this->healthy = true;
        if ($result instanceof \Magento\Framework\App\Response\Http) {
            $this->limitations['full-page-cache-origin'] = true;
        }
    }

    private function loadBlockHtml($block, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== AbstractBlock::class) return;
        if ($this->loadingHtmlOverflow) { $this->loadingHtmlOverflow--; return; }
        $frame = array_pop($this->loadingHtml);
        if (!$frame || $frame['block'] !== $block) {
            $this->errors['Unbalanced block HTML cache hook evidence'] = true;
            return;
        }
        if ($error) return;
        if ($frame['readExpected'] && !$frame['readObserved']) $this->errors['Missing native block HTML cache read hook evidence'] = true;
        if ($frame['readObserved'] && $frame['loaderExpected'] && !$frame['loaderObserved']) {
            $this->errors['Missing native block HTML cache loader hook evidence'] = true;
        }
        if ($frame['cacheData']) $this->limitations['block-html-cache-origin'] = true;
        if (!isset($this->blocks[$block])) return;
        $state = $this->blocks[$block];
        if ($frame['cacheData'] && empty($state['executed'])) {
            $this->event($state['block'], 'layout-block-cache-unconfirmed', $state['context']);
            $this->event($state['template'], 'layout-template-cache-unconfirmed', $state['context']);
        }
        $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? [];
        if (($caller['class'] ?? null) === AbstractBlock::class && ($caller['function'] ?? null) === 'toHtml') {
            $state = $this->blocks[$block];
            $state['html'] = true;
            $this->blocks[$block] = $state;
        }
    }

    private function beginBlockHtml($block, array $params, string $class): void
    {
        if ($class !== AbstractBlock::class) return;
        if ($this->loadingHtmlOverflow || count($this->loadingHtml) >= 256) {
            $this->loadingHtmlOverflow++;
            $this->errors['Layout block HTML cache nesting exceeded 256 calls'] = true;
            return;
        }
        static $property;
        $property ??= new \ReflectionProperty(AbstractBlock::class, 'lockQuery');
        $loader = $property->getValue($block);
        $this->loadingHtml[] = ['block' => $block, 'cacheData' => false, 'readObserved' => false,
            'readExpected' => false, 'readClosure' => null, 'loaderObserved' => false, 'loaderExpected' => is_object($loader)
                && method_exists($loader, 'lockedLoadData')
                && (new \ReflectionMethod($loader, 'lockedLoadData'))->getDeclaringClass()->getName()
                    === \Magento\Framework\Cache\LockGuardedCacheLoader::class];
    }

    private function beginBlockCacheLoader($loader, array $params, string $class): void
    {
        $index = array_key_last($this->loadingHtml);
        if ($index === null || $this->loadingHtmlOverflow || $class !== \Magento\Framework\Cache\LockGuardedCacheLoader::class) return;
        $caller = self::nativeCaller($loader, 'lockedLoadData');
        if (($caller['class'] ?? null) !== AbstractBlock::class || ($caller['function'] ?? null) !== '_loadCache'
            || ($caller['object'] ?? null) !== $this->loadingHtml[$index]['block']) return;
        $this->loadingHtml[$index]['loaderObserved'] = true;
        $callback = $params[1] ?? null;
        if (!$callback instanceof \Closure) return;
        $function = new \ReflectionFunction($callback);
        $this->loadingHtml[$index]['readExpected'] = $function->getClosureThis() === $this->loadingHtml[$index]['block']
            && $function->getClosureScopeClass()?->getName() === AbstractBlock::class
            && $function->getFileName() === (new \ReflectionMethod(AbstractBlock::class, '_loadCache'))->getFileName()
            && LayoutXmlOwnership::bodyMatches($function, '{ return $this->_cache->load($this->getCacheKey()); }');
        if ($this->loadingHtml[$index]['readExpected']) $this->loadingHtml[$index]['readClosure'] = $function->getName();
    }

    private function loadedBlockCache($cache, array $params, $result, ?\Throwable $error): void
    {
        $index = array_key_last($this->loadingHtml);
        if ($error || $index === null || $this->loadingHtmlOverflow) return;
        $caller = LayoutXmlOwnership::caller($cache, 'load', false);
        if (($caller['class'] ?? null) !== AbstractBlock::class
            || !str_starts_with($caller['function'] ?? '', '{closure:' . AbstractBlock::class . '::_loadCache')
            || ($caller['object'] ?? null) !== $this->loadingHtml[$index]['block']) return;
        if ($this->loadingHtml[$index]['readClosure'] !== null && $caller['function'] !== $this->loadingHtml[$index]['readClosure']) return;
        $this->loadingHtml[$index]['readObserved'] = true;
        if (is_string($result)) $this->loadingHtml[$index]['cacheData'] = true;
    }

    private function completeRender($block, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($this->blockRenderOverflow) { $this->blockRenderOverflow--; return; }
        $frame = array_pop($this->blockRenders);
        if (!$frame || $frame['block'] !== $block) {
            $this->errors['Unbalanced block render hook evidence'] = true;
            return;
        }
        if ($error || !isset($this->blocks[$block])) return;
        $evidence = $this->blocks[$block];
        if (!empty($evidence['html']) && $frame['origin'] !== null) {
            $this->event($frame['origin']['id'], 'layout-block-rendered', $frame['origin']['context']);
        }
        $this->event($evidence['executed'] ?? null, 'layout-template-executed', $evidence['context']);
    }

    private function beginTemplate($block, array $params, string $class): void
    {
        if ($this->fetchingOverflow || count($this->fetching) >= 256) {
            $this->fetchingOverflow++;
            $this->errors['Layout template rendering nesting exceeded 256 calls'] = true;
            return;
        }
        $caller = self::nativeCaller($block, 'fetchView');
        $origin = $class === Template::class && ($caller['class'] ?? null) === Template::class
            && ($caller['function'] ?? null) === '_toHtml' ? ($this->blocks[$block]['template'] ?? null) : null;
        if ($origin !== null && !$this->templateOwnership->consume($block, $params[0])) {
            $this->event($origin, 'layout-template-origin-unconfirmed', $this->blocks[$block]['context']);
            $origin = null;
        }
        static $property;
        $property ??= new \ReflectionProperty(Template::class, 'templateContext');
        static $poolProperty;
        $poolProperty ??= new \ReflectionProperty(Template::class, 'templateEnginePool');
        $pool = $poolProperty->getValue($block);
        $this->fetching[] = ['origin' => $origin, 'executed' => false, 'file' => $params[0],
            'block' => $origin === null ? null : $property->getValue($block), 'owner' => $block,
            'engine' => null, 'engineObserved' => false, 'engineExpected' => false, 'observedEngine' => null,
            'poolObserved' => false, 'poolExpected' => (new \ReflectionMethod($pool, 'get'))->getDeclaringClass()->getName()
                === \Magento\Framework\View\TemplateEnginePool::class];
    }

    private function watchTemplateEngine($engine): void
    {
        $this->ownership->watchProducer($engine, Php::class, 'render', $this->beginTemplateEngine(...), $this->renderTemplate(...));
    }

    private function selectedTemplateEngine($pool, array $params, $engine, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->fetching);
        if ($error || $index === null || $this->fetchingOverflow || $class !== \Magento\Framework\View\TemplateEnginePool::class) return;
        $caller = self::nativeCaller($pool, 'get');
        if (($caller['class'] ?? null) !== Template::class || ($caller['function'] ?? null) !== 'fetchView'
            || ($caller['object'] ?? null) !== $this->fetching[$index]['owner']) return;
        $this->fetching[$index]['poolObserved'] = true;
        if (!$engine instanceof Php) return;
        if ($this->fetching[$index]['engine'] !== null) {
            $this->errors['Repeated native template engine selection hook evidence'] = true;
            return;
        }
        $this->watchTemplateEngine($engine);
        $this->engineBeforePlugin->begin($engine, [$this->fetching[$index]['block'], $this->fetching[$index]['file']]);
        $this->fetching[$index]['engine'] = $engine;
        $this->fetching[$index]['engineExpected'] = LayoutXmlOwnership::nativeMethod($engine, Php::class, 'render')
            || $this->engineBeforePlugin->compiled($engine);
    }

    private function beginTemplateEngine($engine, array $params, string $class): void
    {
        $index = array_key_last($this->fetching);
        $caller = self::nativeCaller($engine, 'render');
        $consumer = $index !== null && !$this->fetchingOverflow && ($caller['class'] ?? null) === Template::class
            && ($caller['function'] ?? null) === 'fetchView' && ($caller['object'] ?? null) === $this->fetching[$index]['owner'];
        if ($index !== null && !$this->fetchingOverflow && $this->fetching[$index]['origin'] !== null && $class === Php::class
            && $engine instanceof \Magento\Framework\Interception\InterceptorInterface
            && LayoutXmlOwnership::nativeMethod($engine, Php::class, 'render')
            && (new \ReflectionMethod($engine, 'render'))->getDeclaringClass()->getName() !== Php::class
            && $this->ownership->producerDepth($engine, 'render') === 0) {
            $this->errors['Missing generated template engine hook evidence'] = true;
        }
        $this->startProducer($engine, $class, 'render', $consumer, Php::class);
        if ($index !== null && !$this->fetchingOverflow) {
            $this->fetching[$index]['engineObserved'] = true;
            $this->fetching[$index]['observedEngine'] = $engine;
        }
    }

    private function renderTemplate($engine, array $params, $result, ?\Throwable $error, string $class): void
    {
        $proof = $this->ownership->endProducer($engine, 'render', $error);
        if (!$proof['final']) return;
        $index = array_key_last($this->fetching);
        if ($error || $index === null || $this->fetchingOverflow) return;
        $frame = $this->fetching[$index];
        if ($proof['trusted'] && $frame['block'] === $params[0] && $frame['file'] === $params[1]) {
            $this->fetching[$index]['executed'] = true;
        }
    }

    private function completeTemplate($block, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($this->fetchingOverflow) { $this->fetchingOverflow--; return; }
        $frame = array_pop($this->fetching);
        if ($frame['engine'] !== null) {
            $knownEngine = $this->engineBeforePlugin->complete($frame['engine'], $error,
                $frame['origin'] !== null && $frame['observedEngine'] === $frame['engine']);
            if (!$error && $knownEngine && $frame['engineObserved']) $frame['executed'] = true;
        }
        if (!$error && $frame['origin'] !== null && $frame['engineExpected'] && !$frame['engineObserved']) {
            $this->errors['Missing native template engine hook evidence'] = true;
        }
        if (!$error && $frame['origin'] !== null && $frame['poolExpected'] && $frame['engineObserved'] && !$frame['poolObserved']) {
            $this->errors['Missing native template engine pool hook evidence'] = true;
        }
        if ($error && $frame['origin']) {
            $this->event($frame['origin'], 'layout-template-failed', $this->blocks[$block]['context']);
        }
        if (!$error && $frame['origin'] && $frame['executed']) {
            $state = $this->blocks[$block];
            $state['executed'] = $frame['origin'];
            $this->blocks[$block] = $state;
        } elseif (!$error && $frame['origin']) {
            $this->event($frame['origin'], 'layout-template-origin-unconfirmed', $this->blocks[$block]['context']);
        }
    }

    private function registryContext(): ?array
    {
        foreach (debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS | DEBUG_BACKTRACE_PROVIDE_OBJECT, 32) as $frame) {
            if (isset($frame['object'], $this->blocks[$frame['object']])) return $this->blocks[$frame['object']]['context'];
        }
        $generation = $this->generating[array_key_last($this->generating)] ?? null;
        if (!empty($generation['source']['context'])) return $generation['source']['context'];
        $page = $this->pageBuilders[array_key_last($this->pageBuilders)] ?? null;
        if (!$page) return null;
        static $layoutProperty, $xmlProperty;
        $layoutProperty ??= new \ReflectionProperty(Layout\Builder::class, 'layout');
        $xmlProperty ??= new \ReflectionProperty(XmlConfig::class, '_xml');
        $xml = $xmlProperty->getValue($layoutProperty->getValue($page['builder']));
        if (!$xml instanceof \SimpleXMLElement) return null;
        $root = dom_import_simplexml($xml)->ownerDocument->documentElement;
        foreach ($this->documents as $document) {
            if ($root->isSameNode($document['root'])) return $document['context'];
        }
        return null;
    }

    private function event(?string $id, string $type, ?array $context): void
    {
        if ($id !== null && $context !== null) Recorder::layout($id, $type, $context);
    }
}
