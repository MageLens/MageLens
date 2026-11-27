<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
require '/var/www/html/app/bootstrap.php';
$hooks = dirname(getenv('MAGELENS_XML_HOOKS') ?: (require __DIR__ . '/project-root.php') . '/docker/php/xml-hooks.php');
require $hooks . '/xml-hooks.php';
require $hooks . '/xml-layout-manifest.php';

use MageLens\XmlCoverage\{LayoutCoverage, LayoutManifest, Recorder};
use MageLens\Compatibility\Controller\Dependencies\Index;
use Magento\Framework\App\Area;

$cases = ['native', 'resolver_hook', 'context_hook', 'engine_hook', 'resolver_magic',
    'context_magic', 'engine_magic', 'resolver_redeclared', 'lock_magic', 'lock_shadow'];
$files = [];
foreach ($cases as $case) {
    $path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_dependencies_' . $case . '.xml';
    $source = file_get_contents(BP . '/' . $path);
    $files[$case] = ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
        'declarations' => LayoutManifest::declarations($path, $source)];
}
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets(array_values($files)));
foreach ($callbacks as [$class, $method, $pre, $post]) {
    if (in_array('--without-collector', $argv, true)) continue;
    if (!\MageLens\XmlCoverage\LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot register dependency proof hook');
}
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
$area->load(Area::PART_CONFIG);
$area->load(Area::PART_DESIGN);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$result = $objects->get(Index::class)->execute();
$output = (new ReflectionProperty(Magento\Framework\Controller\Result\Raw::class, 'contents'))->getRawValue($result);
if (substr_count($output, '>verified</span>') !== count($cases)) throw new RuntimeException('Expected ten native dependency outcomes');
echo "Verified native hooked/magic dependencies, ordinary redeclaration and distinct private storage.\n";
echo 'Native dependency reads: ', json_encode(Index::$reads, JSON_THROW_ON_ERROR), "\n";
if (in_array('--without-collector', $argv, true)) exit;
$expected = array_search('--expected-reads', $argv, true);
if ($expected !== false && Index::$reads !== json_decode($argv[$expected + 1], true, flags: JSON_THROW_ON_ERROR)) {
    throw new RuntimeException('Collector changed native dependency getter call counts');
}
$collector->finish();
$events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
foreach ($files as $case => $file) {
    $item = array_values(array_filter($file['declarations'], static fn($item) => $item['layout']['kind'] === 'template'))[0];
    $types = array_values(array_unique(array_column(array_filter($events, static fn($event) => $event['id'] === $item['id']), 'type')));
    sort($types);
    $unknown = in_array($case, ['resolver_hook', 'context_hook', 'engine_hook', 'resolver_magic', 'context_magic', 'engine_magic'], true);
    $dependency = str_starts_with($case, 'engine_') ? 'engine-pool' : explode('_', $case)[0];
    $expected = $unknown ? ['layout-template-' . $dependency . '-storage-unconfirmed', 'layout-template-selected']
        : ['layout-template-executed', 'layout-template-selected'];
    if ($types !== $expected) throw new RuntimeException('Template dependency evidence differs for ' . $case . ': ' . implode(', ', $types));
}
echo "Verified independent original template execution and dependency ownership limitations.\n";
