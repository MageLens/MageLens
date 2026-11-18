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

use MageLens\XmlCoverage\{LayoutCoverage, LayoutManifest, Recorder};
use Magento\Framework\App\PageCache\Kernel;

$mode = $argv[1] ?? 'native';
$nativeOnly = in_array('--native-only', $argv, true);
if (!in_array($mode, ['seed', 'native', 'warm', 'equal', 'missing-pre', 'missing-post', 'depth'], true)) {
    throw new RuntimeException('Unknown full-page cache proof mode');
}
$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_cachepage_index.xml';
$source = file_get_contents(BP . '/' . $path);
$file = ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
    'declarations' => LayoutManifest::declarations($path, $source)];
$register = static function () use ($file, $mode): LayoutCoverage {
    [$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets([$file]));
    foreach ($callbacks as [$class, $method, $pre, $post]) {
        if ($class === Kernel::class && $method === 'load') {
            if ($mode === 'missing-pre') $pre = null;
            if ($mode === 'missing-post') $post = null;
        }
        if (!\OpenTelemetry\Instrumentation\hook($class, $method, $pre, $post)) throw new RuntimeException('Cannot register page cache proof hook');
    }
    if ($mode === 'depth') {
        (new ReflectionProperty(LayoutCoverage::class, 'loadingPages'))->setValue($collector, array_fill(0, 256, []));
    }
    return $collector;
};
$key = getenv('MAGELENS_LAYOUT_PAGE_CACHE_KEY') ?: hash('sha256', random_bytes(32));
if (!preg_match('/^[a-f0-9]{64}$/D', $key)) throw new RuntimeException('Invalid page cache proof identity');
if ($mode === 'warm') {
    $process = proc_open([PHP_BINARY, __FILE__, 'seed'], [0 => STDIN, 1 => ['pipe', 'w'], 2 => STDERR], $pipes,
        env_vars: array_replace(getenv(), ['MAGELENS_LAYOUT_PAGE_CACHE_KEY' => $key]));
    if (!is_resource($process)) throw new RuntimeException('Cannot start separate page cache warm-up');
    $output = stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    if (proc_close($process) !== 0 || trim($output) !== 'Seeded native full-page cache.') {
        throw new RuntimeException('Separate native page cache warm-up failed');
    }
}
$collector = $mode === 'seed' ? null : $register();
$objects = \Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(\Magento\Framework\App\State::class)->setAreaCode('frontend');
$objects->get(\Magento\Framework\App\AreaList::class)->getArea('frontend')->load(\Magento\Framework\App\Area::PART_CONFIG);
$state = $objects->get(\Magento\Framework\App\Cache\StateInterface::class);
foreach (['layout', 'block_html'] as $type) $state->setEnabled($type, false);
$state->setEnabled('full_page', true);
$request = $objects->get(\Magento\Framework\App\Request\Http::class);
$request->setMethod('GET');
$identifier = new class($key) implements \Magento\Framework\App\PageCache\IdentifierInterface {
    public function __construct(private readonly string $value) {}
    public function getValue() { return $this->value; }
};
$kernel = $objects->create(Kernel::class, ['identifier' => $identifier, 'identifierForSave' => $identifier]);
$storage = $objects->get(\Magento\PageCache\Model\Cache\Type::class);
try {
    if ($mode !== 'warm') {
        if ($kernel->load() !== false) throw new RuntimeException('Fresh full-page fixture key already exists');
        $fragment = $objects->create(\Magento\Framework\View\Result\Layout::class, ['isIsolated' => true]);
        $fragment->addHandle('coverageprobe_cachepage_index');
        $contents = $fragment->getLayout()->getOutput();
        if (!str_contains($contents, 'data-layout-page-cache>cached-layout</span>')) {
            throw new RuntimeException('Native full-page fixture layout marker is absent');
        }
        $response = $objects->create(\Magento\Framework\App\Response\Http::class);
        $response->setBody($contents)->setHeader('Cache-Control', 'public, max-age=0, s-maxage=120', true)
            ->setHeader('X-Magento-Tags', 'MAGELENS_LAYOUT_FPC', true);
        $kernel->process($response);
        if ($mode === 'seed') {
            echo "Seeded native full-page cache.\n";
            exit;
        }
    }
    if ($mode === 'equal') {
        $bytes = $storage->load($identifier->getValue());
        if (!is_string($bytes)) throw new RuntimeException('Native full-page cache did not store response data');
        $storage->save($bytes, $identifier->getValue(), [], 120);
        if ($storage->load($identifier->getValue()) !== $bytes) throw new RuntimeException('Equal cache replacement changed stored bytes');
    }
    $cached = $kernel->load();
    if (!$cached instanceof \Magento\Framework\App\Response\Http || ($mode === 'warm'
        ? !str_contains($cached->getBody(), 'data-layout-page-cache>cached-layout</span>')
        : $cached->getBody() !== $contents)) {
        throw new RuntimeException('Native full-page cache failed to return the original response');
    }
    echo "Verified native cold layout output and equal warm full-page response.\n";
    if ($nativeOnly) exit;
    try {
        [$healthy, , $limits] = $collector->finish();
        if (str_starts_with($mode, 'missing-') || $mode === 'depth') throw new LogicException('Missing page cache observations were accepted');
    } catch (RuntimeException $error) {
        $expected = ['missing-pre' => 'Unbalanced full-page cache hook evidence',
            'missing-post' => 'Unbalanced full-page cache hook evidence',
            'depth' => 'Layout full-page cache nesting exceeded 256 calls'][$mode] ?? null;
        if (!$expected || !str_contains($error->getMessage(), $expected)) throw $error;
        echo "Verified full-page cache publication guard for $mode.\n";
        exit;
    }
    if (!$healthy || !in_array('full-page-cache-origin', $limits, true)) throw new RuntimeException('Full-page cache origin limitation is absent');
    $events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
    if ($mode === 'warm' && $events) throw new RuntimeException('A warm full-page response inferred fresh XML effects');
    $payload = json_encode($events, JSON_THROW_ON_ERROR);
    foreach (['cached-layout', 'data-layout-page-cache', $identifier->getValue()] as $private) {
        if (str_contains($payload, $private)) throw new RuntimeException('Full-page evidence retained response bytes or cache identifiers');
    }
    echo "Verified cache limitation with zero inferred layout effects from cached bytes.\n";
} finally {
    if ($mode !== 'seed') $storage->remove($identifier->getValue());
}
