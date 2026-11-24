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
use Magento\Framework\App\Area;

$files = [];
foreach (['base', 'overlay', 'unvisited'] as $case) {
    $path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_falsy_' . $case . '.xml';
    $source = file_get_contents(BP . '/' . $path);
    $files[$case] = ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
        'declarations' => LayoutManifest::declarations($path, $source)];
}
if (in_array('--zero-class-only', $argv, true)) {
    foreach ($files as &$file) $file['declarations'] = array_values(array_filter($file['declarations'], static fn($item) =>
        $item['layout']['element'] === 'magelens.falsy.wrapper' && $item['layout']['attribute'] === 'htmlClass'));
    unset($file);
}
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets(array_values($files)));
foreach ($callbacks as [$class, $method, $pre, $post]) {
    if (in_array('--without-collector', $argv, true)) continue;
    if (!\MageLens\XmlCoverage\LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot register falsy proof hook');
}
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
$area->load(Area::PART_CONFIG);
$area->load(Area::PART_DESIGN);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$result = $objects->get(MageLens\Compatibility\Controller\Falsy\Index::class)->execute();
$output = (new ReflectionProperty(Magento\Framework\Controller\Result\Raw::class, 'contents'))->getRawValue($result);
if (substr_count($output, 'data-layout-falsy="') !== 10 || !str_contains($output, 'data-layout-falsy-proof>verified</span>')
    || !str_contains($output, '<section0>')) throw new RuntimeException('Native falsy output changed');
echo "Verified native empty block attributes, zero visibility/removals and malformed zero-class interpolation.\n";
if (in_array('--without-collector', $argv, true)) exit;
$collector->finish();
$events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
if (in_array('--zero-class-only', $argv, true)) {
    $structure = (new ReflectionProperty(LayoutCoverage::class, 'structureCoverage'))->getValue($collector);
    if (!$structure->finish()[0] || count($events) !== 1
        || array_values($events)[0]['type'] !== 'layout-container-wrapper-zero-class-emitted') {
        throw new RuntimeException('A sole original zero-class output must establish its native hook health');
    }
    echo "Verified native hook health with only the zero-class operand inventoried.\n";
    exit;
}
foreach ([['base', 'zero', 'template', 'layout-template-empty-ignored'],
    ['base', 'zero', 'group', 'layout-block-group-empty-ignored'], ['base', 'zero', 'ttl', 'layout-block-ttl-empty-ignored'],
    ['base', 'empty', 'template', 'layout-template-empty-ignored'], ['base', 'wrapper', 'htmlClass', 'layout-container-wrapper-zero-class-emitted'],
    ['overlay', 'override.zero', 'template', 'layout-template-empty-ignored'],
    ['overlay', 'override.empty', 'template', 'layout-template-empty-ignored'],
    ['overlay', 'zero', 'display', 'layout-display-empty-ignored'],
    ['overlay', 'removed.block', 'remove', 'layout-removal-empty-ignored'],
    ['overlay', 'removed.container', 'remove', 'layout-removal-empty-ignored']] as [$file, $element, $attribute, $expected]) {
    $item = array_values(array_filter($files[$file]['declarations'], static fn($item) =>
        $item['layout']['element'] === 'magelens.falsy.' . $element && $item['layout']['attribute'] === $attribute))[0];
    $types = array_values(array_unique(array_column(array_filter($events, static fn($event) => $event['id'] === $item['id']), 'type')));
    if ($types !== [$expected]) throw new RuntimeException('Missing original falsy operand evidence for ' . $element . '/' . $attribute . ': ' . implode(', ', $types));
}
foreach ($files['unvisited']['declarations'] as $item) {
    if (array_filter($events, static fn($event) => $event['id'] === $item['id'])) throw new RuntimeException('Unvisited falsy operand received evidence');
}
echo "Verified independent original falsy operand facts and zero unvisited events.\n";
