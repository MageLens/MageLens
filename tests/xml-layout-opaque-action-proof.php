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

use MageLens\XmlCoverage\{LayoutCoverage, LayoutManifest, LayoutRuntimeHooks, Recorder};
use Magento\Framework\View\Layout\Reader\Block as BlockReader;

class MageLensOpaqueActionValue implements ArrayAccess
{
    public static int $serializations = 0;
    public function offsetExists(mixed $offset): bool { return false; }
    public function offsetGet(mixed $offset): mixed { return null; }
    public function offsetSet(mixed $offset, mixed $value): void { throw new LogicException('Unexpected native opaque write'); }
    public function offsetUnset(mixed $offset): void { throw new LogicException('Unexpected native opaque unset'); }
    public function __serialize(): array { self::$serializations++; return []; }
}
class MageLensOpaqueActionParser extends Magento\Framework\View\Layout\Argument\Parser
{
    public function parse(DOMNode $node)
    {
        return $node instanceof DOMElement && $node->parentNode?->nodeName === 'action' && $node->getAttribute('name') === 'value'
            ? new MageLensOpaqueActionValue() : parent::parse($node);
    }
}
$saved = [];
$slot = new ReflectionProperty(BlockReader::class, 'argumentParser');
OpenTelemetry\Instrumentation\hook(BlockReader::class, 'getActions',
    static function ($reader) use ($slot, &$saved): void {
        $saved[] = $slot->getRawValue($reader);
        $slot->setRawValue($reader, new MageLensOpaqueActionParser());
    }, static function ($reader) use ($slot, &$saved): void { $slot->setRawValue($reader, array_pop($saved)); });
$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_packagemutation_native.xml';
$source = file_get_contents(BP . '/' . $path);
$files = [
    ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source), 'declarations' => LayoutManifest::declarations($path, $source)],
];
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
if (!in_array('--without-collector', $argv, true)) foreach ($callbacks as [$class, $method, $pre, $post]) {
    if (!LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot observe opaque action proof');
}
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
foreach ([Magento\Framework\App\Area::PART_CONFIG, Magento\Framework\App\Area::PART_DESIGN] as $part) $area->load($part);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$objects->get(Magento\Framework\App\ViewInterface::class);
$page = $objects->get(Magento\Framework\View\Result\PageFactory::class)->create(true, ['isIsolated' => true]);
$page->addHandle('coverageprobe_packagemutation_native');
$layout = $page->getLayout();
$layout->getUpdate()->load();
$layout->getUpdate()->addUpdate('<body><referenceBlock name="magelens.layout.package.native"><action method="setData"><argument name="key" xsi:type="string">opaque_probe</argument><argument name="value" xsi:type="string">opaque</argument></action></referenceBlock></body>');
$block = $layout->getBlock('magelens.layout.package.native');
if (!$block || !$block->getData('opaque_probe') instanceof MageLensOpaqueActionValue
    || !str_contains($block->toHtml(), 'data-layout-mutation>xml-value</span>') || $saved) {
    throw new RuntimeException('Native opaque action value, output or dependency restoration changed');
}
if (hash_file('sha256', BP . '/' . $path) !== hash('sha256', $source)) throw new RuntimeException('Opaque fixture changed original XML');
echo "Verified native opaque action application and unchanged original output/XML.\n";
if (MageLensOpaqueActionValue::$serializations !== 0) throw new RuntimeException('Collection executed an application serialization method');
if (!in_array('--without-collector', $argv, true)) {
    $evidence = $collector->finish();
    if (!in_array('layout-opaque-action-data', $evidence[2], true)) throw new RuntimeException('Opaque action path lacks its explicit limitation');
    $events = array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue());
    foreach (['opaque_probe', 'MageLensOpaqueActionValue', 'xml-value', 'data-layout-mutation'] as $privateValue) {
        if (str_contains(json_encode($events, JSON_THROW_ON_ERROR), $privateValue)) throw new RuntimeException('Opaque action evidence retained application data');
    }
    $destination = array_search('--evidence-file', $argv, true);
    if ($destination !== false) {
        $json = json_encode(['files' => $files, 'layoutSources' => LayoutManifest::targets($files), 'layoutHook' => $evidence[0],
            'layoutSourceTrace' => $evidence[1], 'layoutLimitations' => $evidence[2], 'events' => $events], JSON_THROW_ON_ERROR);
        if (file_put_contents($argv[$destination + 1], $json) !== strlen($json)) throw new RuntimeException('Cannot save bounded opaque action evidence');
    }
}
echo "Verified action inspection never executes application serialization.\n";
