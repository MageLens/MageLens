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
use Magento\Framework\View\Element\Template;

class MageLensExternalScopedWriter
{
    public static int $writes = 0;
    public static function write(Template $block, string $field, string $method): void
    {
        $write = function () use ($field): void {
            MageLensExternalScopedWriter::$writes++;
            $this->$field = $field === '_template' ? 'MageLens_Compatibility::layout-mutation.phtml'
                : ['value' => 'xml-value', 'late' => 'xml-value'];
        };
        if ($method === 'call') $write->call($block);
        else {
            $bound = $method === 'bind' ? Closure::bind($write, $block, Template::class)
                : $write->bindTo($block, Template::class);
            $bound();
        }
    }
}
$field = $argv[1] ?? 'template';
$method = $argv[2] ?? 'bind';
if (!in_array($field, ['template', 'data'], true) || !in_array($method, ['bind', 'bindTo', 'call'], true)) {
    throw new RuntimeException('Unknown scoped closure fixture selection');
}
$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_packagemutation_native.xml';
$source = file_get_contents(BP . '/' . $path);
$declarations = LayoutManifest::declarations($path, $source);
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets([
    ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source), 'declarations' => $declarations],
]));
$missingIndex = array_search('--missing-hook', $argv, true);
$missing = $missingIndex === false ? null : $argv[$missingIndex + 1];
if (!in_array('--without-collector', $argv, true)) foreach ($callbacks as [$class, $name, $pre, $post]) {
    if ($class === Closure::class && $name === $missing) continue;
    if (!LayoutRuntimeHooks::register($class, $name, $pre, $post)) throw new RuntimeException('Cannot observe scoped closure fixture');
}
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
foreach ([Magento\Framework\App\Area::PART_CONFIG, Magento\Framework\App\Area::PART_DESIGN] as $part) $area->load($part);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$objects->get(Magento\Framework\App\ViewInterface::class);
$page = $objects->get(Magento\Framework\View\Result\PageFactory::class)->create(true, ['isIsolated' => true]);
$page->addHandle('coverageprobe_packagemutation_native');
$block = $page->getLayout()->getBlock('magelens.layout.package.native');
MageLensExternalScopedWriter::write($block, $field === 'template' ? '_template' : '_data', $method);
if (!str_contains($block->toHtml(), 'data-layout-mutation>xml-value</span>') || MageLensExternalScopedWriter::$writes !== 1
    || hash_file('sha256', BP . '/' . $path) !== hash('sha256', $source)) {
    throw new RuntimeException('Native external scoped closure effect, output or XML changed');
}
echo "Verified native external scoped closure write and unchanged output/source.\n";
if (in_array('--without-collector', $argv, true)) exit;
try {
    $collector->finish();
    if ($missing !== null) throw new LogicException('Missing scoped observer did not block publication');
} catch (RuntimeException $error) {
    if ($missing === null || $error->getMessage() !== 'Missing native scoped closure hook evidence') throw $error;
    echo "Missing scoped closure observer preserves native output and blocks publication.\n";
    exit;
}
$events = array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue());
foreach ($declarations as $declaration) {
    $kind = $declaration['layout']['kind'];
    if ($kind !== 'template' && !($kind === 'argument' && $declaration['layout']['element'] === 'value')) continue;
    $effects = array_column(array_filter($events, static fn($event) => $event['id'] === $declaration['id']), 'type');
    if (in_array($kind === 'template' ? 'layout-template-executed' : 'layout-argument-read', $effects, true)) {
        throw new RuntimeException('An external scoped closure retained unproved original XML consumption');
    }
    if (!in_array($kind === 'template' ? 'layout-template-field-access-unconfirmed' : 'layout-argument-field-access-unconfirmed', $effects, true)) {
        throw new RuntimeException('External scoped closure lacks an explicit original field ownership limitation');
    }
    if ($kind === 'argument' && !in_array('layout-argument-applied', $effects, true)) {
        throw new RuntimeException('Scoped closure erased earlier native XML argument application');
    }
}
echo "Verified explicit scoped closure ownership limits preserve earlier independent application.\n";
