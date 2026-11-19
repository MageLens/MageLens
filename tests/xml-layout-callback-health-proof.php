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
$case = $argv[1] ?? 'healthy';
if (!in_array($case, ['healthy', 'pre', 'post'], true)) throw new RuntimeException('Unknown callback health case');
$files = [];
foreach (['base', 'overlay', 'containers', 'move'] as $handle) {
    $path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_names_' . $handle . '.xml';
    $source = file_get_contents(BP . '/' . $path);
    $files[] = ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
        'declarations' => LayoutManifest::declarations($path, $source)];
}
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
$injected = 0;
foreach ($callbacks as [$class, $method, $pre, $post]) {
    if ($class === Magento\Framework\View\Layout::class && $method === 'generateXml' && $case !== 'healthy') {
        $original = $case === 'pre' ? $pre : $post;
        $failing = static function (...$params) use ($original, &$injected) {
            $original(...$params);
            $injected++;
            throw new RuntimeException('private-callback-payload-must-not-escape');
        };
        if ($case === 'pre') $pre = $failing; else $post = $failing;
    }
    if (class_exists(MageLens\XmlCoverage\LayoutRuntimeHooks::class)) {
        $pre = MageLens\XmlCoverage\LayoutRuntimeHooks::wrap($pre);
        $post = MageLens\XmlCoverage\LayoutRuntimeHooks::wrap($post);
    }
    if (!OpenTelemetry\Instrumentation\hook($class, $method, $pre, $post)) throw new RuntimeException('Cannot register callback health proof');
}
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
$area->load(Magento\Framework\App\Area::PART_CONFIG); $area->load(Magento\Framework\App\Area::PART_DESIGN);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$objects->get(Magento\Framework\App\ViewInterface::class);
$objects->get(Magento\Framework\App\RequestInterface::class)->setParam('case', 'containers');
$result = $objects->create(MageLens\Compatibility\Controller\Names\Index::class)->execute();
$response = $objects->create(Magento\Framework\App\Response\Http::class);
$result->renderResult($response);
if (!str_contains($response->getBody(), '<span data-layout-name-proof>verified</span>')
    || substr_count($response->getBody(), 'data-layout-name-case=') !== 1) throw new RuntimeException('Callback observation changed native layout output');
echo "Verified unchanged native layout output for callback case $case.\n";
if ($case !== 'healthy' && $injected === 0) throw new RuntimeException('The native path did not invoke the failing observer');
(new ReflectionProperty(Recorder::class, 'manifest'))->setValue(null, ['run' => 'callback-health-proof', 'id' => 'callback-health-proof']);
(new ReflectionProperty(Recorder::class, 'layout'))->setValue(null, $collector);
try {
    $state = $collector->finish();
    if ($case !== 'healthy') throw new RuntimeException('Observer exception did not block incomplete coverage');
    if (!$state[0] || !$state[1]) throw new RuntimeException('Healthy callback path lost original source evidence');
    $record = Recorder::finish();
    if (!$record['layoutHook'] || !$record['layoutSourceTrace']) throw new RuntimeException('Healthy request record lost native hook evidence');
    foreach ($files as $file) foreach ($file['declarations'] as $item) {
        if (($item['layout']['kind'] ?? '') !== 'block' || ($item['layout']['element'] ?? '') !== 'numeric.container.child') continue;
        $types = array_unique(array_column(array_filter($record['events'], static fn(array $event): bool => $event['id'] === $item['id']), 'type'));
        if (!in_array('layout-block-rendered', $types, true)) throw new RuntimeException('Guarded callback changed original block render attribution');
    }
} catch (RuntimeException $error) {
    if ($case === 'healthy' || $error->getMessage() !== 'Layout runtime hook callback failed') throw $error;
    if ($injected !== 1) throw new RuntimeException('Failed observer was invoked again');
    try {
        Recorder::finish();
        throw new RuntimeException('Request recorder accepted a failed layout observer');
    } catch (RuntimeException $publicationError) {
        if ($publicationError->getMessage() !== 'Layout runtime hook callback failed') throw $publicationError;
    }
    echo "Verified bounded fail-closed callback health without private exception data.\n";
}
