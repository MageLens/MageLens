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

$mode = $argv[1] ?? 'return';
if (!in_array($mode, ['return', 'alias', 'foreach'], true)) throw new RuntimeException('Unknown native data reference mode');
if ($mode === 'return') {
    class MageLensReferenceDataFixture extends Template
    {
        public static int $writes = 0;
        protected function &referenceData(): array { return $this->_data; }
        protected function _beforeToHtml()
        {
            $data =& $this->referenceData();
            $data['value'] = 'xml-value';
            self::$writes++;
            return parent::_beforeToHtml();
        }
    }
} elseif ($mode === 'alias') {
    class MageLensReferenceDataFixture extends Template
    {
        public static int $writes = 0;
        protected function _beforeToHtml()
        {
            $data =& $this->_data;
            $data['value'] = 'xml-value';
            self::$writes++;
            return parent::_beforeToHtml();
        }
    }
} else {
    class MageLensReferenceDataFixture extends Template
    {
        public static int $writes = 0;
        protected function _beforeToHtml()
        {
            foreach ($this->_data as $key => &$value) {
                if ($key === 'value') { $value = 'xml-value'; self::$writes++; }
            }
            unset($value);
            return parent::_beforeToHtml();
        }
    }
}
$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_packagemutation_native.xml';
$source = file_get_contents(BP . '/' . $path);
$declarations = LayoutManifest::declarations($path, $source);
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets([
    ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source), 'declarations' => $declarations],
]));
if (!in_array('--without-collector', $argv, true)) foreach ($callbacks as [$class, $method, $pre, $post]) {
    if (!LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot observe direct data fixture');
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
    $config->extend(['arguments' => [MageLensReferenceDataFixture::class => $arguments]]);
}
$objects->configure(['preferences' => [Template::class => MageLensReferenceDataFixture::class]]);
$objects->get(Magento\Framework\App\ViewInterface::class);
$page = $objects->get(Magento\Framework\View\Result\PageFactory::class)->create(true, ['isIsolated' => true]);
$page->addHandle('coverageprobe_packagemutation_native');
$block = $page->getLayout()->getBlock('magelens.layout.package.native');
if (!$block instanceof MageLensReferenceDataFixture
    || !str_contains($block->toHtml(), 'data-layout-mutation>xml-value</span>')
    || MageLensReferenceDataFixture::$writes !== 1) {
    throw new RuntimeException('Native direct data write or rendered output changed');
}
if (hash_file('sha256', BP . '/' . $path) !== hash('sha256', $source)) throw new RuntimeException('Original fixture XML changed');
echo "Verified native equal-valued PHP data assignment through a reference and unchanged original XML.\n";
if (in_array('--without-collector', $argv, true)) exit;
$collector->finish();
$value = array_values(array_filter($declarations, static fn($item) => $item['layout']['kind'] === 'argument'
    && $item['layout']['element'] === 'value'))[0];
$events = array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue());
$effects = array_column(array_filter($events, static fn($event) => $event['id'] === $value['id']), 'type');
if (!in_array('layout-argument-applied', $effects, true)
    || !in_array('layout-argument-field-access-unconfirmed', $effects, true)
    || in_array('layout-argument-read', $effects, true)) {
    throw new RuntimeException('Direct PHP data write retained original XML read credit or erased earlier application');
}
echo "Verified direct-field data read limitation and independent earlier XML application.\n";
$template = array_values(array_filter($declarations, static fn($item) => $item['layout']['kind'] === 'template'))[0];
$templateEffects = array_column(array_filter($events, static fn($event) => $event['id'] === $template['id']), 'type');
if (!in_array('layout-template-executed', $templateEffects, true)) throw new RuntimeException('Data reference erased independent original template execution');
