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

class MageLensDirectTemplateFixture extends Template
{
    public static int $writes = 0;
    protected function _beforeToHtml()
    {
        self::$writes++;
        $this->_template = 'MageLens_Compatibility::layout-mutation.phtml';
        return parent::_beforeToHtml();
    }
}
$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_packagemutation_native.xml';
$source = file_get_contents(BP . '/' . $path);
$declarations = LayoutManifest::declarations($path, $source);
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets([
    ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source), 'declarations' => $declarations],
]));
if (!in_array('--without-collector', $argv, true)) foreach ($callbacks as [$class, $method, $pre, $post]) {
    if (!LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot observe direct template fixture');
}
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
foreach ([Magento\Framework\App\Area::PART_CONFIG, Magento\Framework\App\Area::PART_DESIGN] as $part) $area->load($part);
foreach (['layout', 'block_html', 'full_page'] as $type) {
    $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
}
$config = $objects->get(Magento\Framework\ObjectManager\ConfigInterface::class);
if ($config instanceof Magento\Framework\ObjectManager\Config\Compiled) {
    $parameters = array_column((new ReflectionMethod(Template::class, '__construct'))->getParameters(), 'name');
    $arguments = array_intersect_key($config->getArguments(Template::class) ?? [], array_fill_keys($parameters, true));
    $config->extend(['arguments' => [MageLensDirectTemplateFixture::class => $arguments]]);
}
$objects->configure(['preferences' => [Template::class => MageLensDirectTemplateFixture::class]]);
$objects->get(Magento\Framework\App\ViewInterface::class);
$page = $objects->get(Magento\Framework\View\Result\PageFactory::class)->create(true, ['isIsolated' => true]);
$page->addHandle('coverageprobe_packagemutation_native');
$block = $page->getLayout()->getBlock('magelens.layout.package.native');
if (!$block instanceof MageLensDirectTemplateFixture
    || !str_contains($block->toHtml(), 'data-layout-mutation>xml-value</span>')
    || MageLensDirectTemplateFixture::$writes !== 1) {
    throw new RuntimeException('Native direct template write or rendered output changed');
}
if (hash_file('sha256', BP . '/' . $path) !== hash('sha256', $source)) throw new RuntimeException('Original fixture XML changed');
echo "Verified native equal-valued direct PHP template assignment and unchanged original XML.\n";
if (in_array('--without-collector', $argv, true)) exit;
$collector->finish();
$template = array_values(array_filter($declarations, static fn($item) => $item['layout']['kind'] === 'template'))[0];
$events = array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue());
$effects = array_column(array_filter($events, static fn($event) => $event['id'] === $template['id']), 'type');
if (in_array('layout-template-executed', $effects, true)) {
    throw new RuntimeException('Direct PHP template write retained original XML execution credit');
}
