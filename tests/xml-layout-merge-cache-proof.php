<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
require '/var/www/html/app/bootstrap.php';
$hooks = dirname(getenv('MAGELENS_XML_HOOKS') ?: __DIR__ . '/../docker/php/xml-hooks.php');
require $hooks . '/xml-hooks.php';
require $hooks . '/xml-layout-manifest.php';

use MageLens\XmlCoverage\{LayoutCoverage, LayoutManifest, LayoutRuntimeHooks, Recorder};
use Magento\Framework\View\Model\Layout\Merge;

// Constructor inputs isolate native cache keys without changing XML or cache bytes.
class MageLensCacheProcessorFactory extends Magento\Framework\View\Layout\ProcessorFactory
{
    public string $suffix;
    public int $creates = 0;
    public function create(array $data = []) { $this->creates++; return parent::create($data + ['cacheSuffix' => $this->suffix, 'cacheLifetime' => 60]); }
}
class MageLensCacheLayoutFactory extends Magento\Framework\View\LayoutFactory
{
    public MageLensCacheProcessorFactory $processor;
    public function create(array $data = []) { return parent::create($data + ['processorFactory' => $this->processor, 'cacheLifetime' => 60]); }
}

$mode = $argv[1] ?? 'cold';
$seed = in_array('--seed', $argv, true);
$nativeOnly = in_array('--without-collector', $argv, true);
if (!in_array($mode, ['cold', 'package', 'merge', 'schedule', 'stale-provider'], true)) throw new RuntimeException('Unknown layout cache proof mode');
$nonce = getenv('MAGELENS_LAYOUT_CACHE_PROOF') ?: bin2hex(random_bytes(16));
if (!preg_match('/^[a-f0-9]{32}$/D', $nonce)) throw new RuntimeException('Invalid isolated cache identity');
$keys = [];
if (!$seed && $mode !== 'cold') {
    $process = proc_open([PHP_BINARY, __FILE__, $mode, '--seed', '--without-collector'],
        [0 => STDIN, 1 => ['pipe', 'w'], 2 => STDERR], $pipes,
        env_vars: array_replace(getenv(), ['MAGELENS_LAYOUT_CACHE_PROOF' => $nonce]));
    if (!is_resource($process)) throw new RuntimeException('Cannot start native layout cache warm-up');
    $json = stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    if (proc_close($process) !== 0) throw new RuntimeException('Native layout cache warm-up failed');
    $keys = json_decode($json, true, flags: JSON_THROW_ON_ERROR);
    if (array_keys($keys) !== ['package', 'merge', 'schedule']) throw new RuntimeException('Unexpected native cache key inventory');
}

$handles = ['coverageprobe_packagemutation_native', 'coverageprobe_component_index'];
$files = [];
foreach ($handles as $handle) {
    $path = 'app/code/MageLens/Compatibility/view/frontend/layout/' . $handle . '.xml';
    $source = file_get_contents(BP . '/' . $path);
    $files[] = ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
        'declarations' => LayoutManifest::declarations($path, $source)];
}
if (!$nativeOnly) {
    [$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
    foreach ($callbacks as [$class, $method, $pre, $post]) {
        if (!LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot observe native layout cache proof');
    }
}
$saved = [];
OpenTelemetry\Instrumentation\hook(Merge::class, '_saveCache', static function ($merge, $params) use (&$saved): void {
    $saved[] = $params[1];
}, null);
$replacements = 0;
if ($seed && $mode === 'stale-provider') OpenTelemetry\Instrumentation\hook(Magento\Framework\View\Layout\Builder::class, 'generateLayoutXml',
    static function ($builder) use ($nonce, &$replacements): void {
        $layout = (new ReflectionProperty(Magento\Framework\View\Layout\Builder::class, 'layout'))->getRawValue($builder);
        if (!in_array('magelens_cache_probe_' . $nonce, $layout->getUpdate()->getHandles(), true)) return;
        $layout->getUpdate()->addUpdate('<referenceBlock xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" name="magelens.layout.package.native"><arguments><argument name="value" xsi:type="string">cached-provider</argument></arguments></referenceBlock>');
        $replacements++;
    }, null);
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
foreach ([Magento\Framework\App\Area::PART_CONFIG, Magento\Framework\App\Area::PART_DESIGN] as $part) $area->load($part);
$state = $objects->get(Magento\Framework\App\Cache\StateInterface::class);
$previous = [];
foreach (['layout', 'block_html', 'full_page'] as $type) {
    $previous[$type] = $state->isEnabled($type);
    $state->setEnabled($type, $type === 'layout');
}
$storage = $objects->get(Magento\Framework\App\Cache\Type\Layout::class);
$objects->get(Magento\Framework\App\ViewInterface::class);
$processor = new MageLensCacheProcessorFactory($objects);
$processor->suffix = '_magelens_probe_' . $nonce;
$factory = new MageLensCacheLayoutFactory($objects);
$factory->processor = $processor;
$seeded = false;
$merge = null;
try {
    if (!$seed) foreach (match ($mode) {
        'package' => ['merge', 'schedule'], 'merge' => ['schedule'], 'schedule' => ['package', 'merge'], default => [],
    } as $remove) $storage->remove($keys[$remove]);
    $page = $objects->get(Magento\Framework\View\Result\PageFactory::class)->create(true,
        ['isIsolated' => true, 'layoutFactory' => $factory]);
    $page->addHandle([...$handles, 'magelens_cache_probe_' . $nonce]);
    $layout = $page->getLayout();
    $merge = $layout->getUpdate();
    $block = $layout->getBlock('magelens.layout.package.native');
    $expected = $mode === 'stale-provider' ? 'cached-provider' : 'xml-value';
    if (!$block || !str_contains($block->toHtml(), 'data-layout-mutation>' . $expected . '</span>')) {
        throw new RuntimeException('Native layout cache output changed for ' . $mode);
    }
    if (!$layout->getBlock('magelens_layout_ui') instanceof \Magento\Ui\Component\Wrapper\UiComponent
        || $layout->hasElement('magelens_layout_ui_denied')) throw new RuntimeException('Native layout cache visibility changed for ' . $mode);
    if ($seed && $mode === 'stale-provider' && $replacements !== 1) throw new RuntimeException('Native cached provider replacement count changed');
    $merge = $layout->getUpdate();
    $keys = ['package' => (new ReflectionMethod($merge, 'generateCacheId'))->invoke($merge, $processor->suffix),
        'merge' => $merge->getCacheId() . '_' . Merge::PAGE_LAYOUT_CACHE_SUFFIX,
        'schedule' => 'structure_' . $merge->getCacheId()];
    if ($processor->creates !== 1) throw new RuntimeException('Native cache fixture factory count changed');
    foreach ($keys as $kind => $key) if (!is_string($storage->load($key))) throw new RuntimeException('Expected native layout cache entry is absent: ' . $kind);
    if ($seed) { $seeded = true; echo json_encode($keys, JSON_THROW_ON_ERROR); return; }
    echo 'Verified native isolated layout cache output: ', $mode, ".\n";
    if ($nativeOnly) return;
    $evidence = $collector->finish();
    $limits = $evidence[2];
    $events = array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue());
    $target = array_column(array_merge(...array_column($files, 'declarations')), null, 'id');
    $effects = array_values(array_filter($events, static fn($event) => isset($target[$event['id']])));
    $required = match ($mode) {
        'package' => ['layout-package-cache'], 'merge' => ['layout-merge-cache'],
        'schedule' => ['scheduled-layout-cache'], 'stale-provider' => ['layout-merge-cache', 'scheduled-layout-cache'], default => [],
    };
    foreach ($required as $limit) if (!in_array($limit, $limits, true)) throw new RuntimeException('Missing native cache limitation: ' . $limit);
    if ($mode === 'cold') {
        foreach (['layout-block-rendered', 'layout-template-executed', 'layout-argument-read', 'layout-condition-denied'] as $effect) {
            if (!in_array($effect, array_column($effects, 'type'), true)) throw new RuntimeException('Cold layout lacks original effect: ' . $effect);
        }
    } else {
        foreach ($effects as $event) if (in_array($event['type'], ['layout-block-created', 'layout-block-rendered', 'layout-template-executed',
            'layout-argument-applied', 'layout-argument-read', 'layout-condition-allowed', 'layout-condition-denied'], true)) {
            throw new RuntimeException('Cached layout inferred fresh original effect: ' . $event['type']);
        }
    }
    foreach ($files as $file) {
        if (hash_file('sha256', BP . '/' . $file['path']) !== $file['sourceHash']) throw new RuntimeException('Native cache proof changed XML source');
    }
    foreach (['xml-value', 'cached-provider', 'data-layout-mutation'] as $privateValue) {
        if (str_contains(json_encode($events, JSON_THROW_ON_ERROR), $privateValue)) throw new RuntimeException('Layout cache evidence retained response or value bytes');
    }
    $destination = array_search('--evidence-file', $argv, true);
    if ($destination !== false) {
        $json = json_encode(['files' => $files, 'layoutSources' => LayoutManifest::targets($files), 'layoutHook' => $evidence[0],
            'layoutSourceTrace' => $evidence[1], 'layoutLimitations' => $limits, 'events' => $events], JSON_THROW_ON_ERROR);
        if (file_put_contents($argv[$destination + 1], $json) !== strlen($json)) throw new RuntimeException('Cannot save bounded native cache evidence');
    }
    echo 'Verified exact original-source layout cache boundary: ', $mode, ".\n";
} finally {
    if (!$seeded && $merge !== null) {
        $keys[] = (new ReflectionMethod($merge, 'generateCacheId'))->invoke($merge, $processor->suffix);
        $keys[] = $merge->getCacheId() . '_' . Merge::PAGE_LAYOUT_CACHE_SUFFIX;
        $keys[] = 'structure_' . $merge->getCacheId();
    }
    if (!$seeded) foreach (array_unique([...$keys, ...array_filter($saved, static fn($key) => str_contains($key, '_magelens_probe_' . $nonce))]) as $key) $storage->remove($key);
    foreach ($previous as $type => $enabled) $state->setEnabled($type, $enabled);
}
