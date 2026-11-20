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
use Magento\Framework\App\Area;
use Magento\Framework\App\RequestInterface;
use Magento\Framework\Url;
use Magento\Framework\View\Page\Config\Generator\Head;

$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_page_controller_asset.xml';
$source = file_get_contents(BP . '/' . $path);
$file = ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
    'declarations' => LayoutManifest::declarations($path, $source)];
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets([$file]));
$nativeOnly = in_array('--without-collector', $argv, true);
$custom = in_array('--custom-url', $argv, true);
$missingPre = in_array('--missing-url-pre', $argv, true);
$missingPost = in_array('--missing-url-post', $argv, true);
if (!$nativeOnly) foreach ($callbacks as [$class, $method, $pre, $post]) {
    if ($class === Url::class && $method === 'getUrl') {
        if ($missingPre) $pre = null;
        if ($missingPost) $post = null;
    }
    if (!LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot observe native controller asset');
}
if ($custom) {
    $field = new ReflectionProperty(Head::class, 'url');
    $original = null;
    if (!LayoutRuntimeHooks::register(Head::class, 'processAssets',
        static function ($generator) use ($field, &$original): void {
            $original = $field->getRawValue($generator);
            $field->setRawValue($generator, new class($original) extends Url {
                public function __construct(private Url $delegate)
                {
                }

                public function getUrl($routePath = null, $routeParams = null)
                {
                    return $this->delegate->getUrl($routePath, $routeParams);
                }
            });
        }, static function ($generator) use ($field, &$original): void {
            if ($original) $field->setRawValue($generator, $original);
        })) throw new RuntimeException('Cannot install disposable controller URL provider');
}
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
$area->load(Area::PART_CONFIG);
$area->load(Area::PART_DESIGN);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$objects->get(RequestInterface::class)->setParam('variant', 'controller-asset');
$page = $objects->get(MageLens\Compatibility\Controller\Handle\Index::class)->execute();
$response = $objects->create(Magento\Framework\App\Response\Http::class);
$page->renderResult($response);
$document = new DOMDocument();
$document->loadHTML($response->getBody(), LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
$xpath = new DOMXPath($document);
$links = $xpath->query('//head/link[@rel="magelens-controller-fixture"]');
$url = $links->item(0)?->getAttribute('href');
if ($links->length !== 1 || !is_string($url) || !str_contains((string) parse_url($url, PHP_URL_PATH), '/coverageprobe/fragment/')) {
    throw new RuntimeException('Expected one native link with a generated storefront route URL');
}
if (hash_file('sha256', BP . '/' . $path) !== $file['sourceHash']) throw new RuntimeException('Controller asset fixture changed original XML');
echo "Verified native controller asset URL and output.\n";
if ($nativeOnly) exit;
if ($missingPre || $missingPost) {
    try {
        $collector->finish();
    } catch (RuntimeException $error) {
        if (!preg_match('/Layout runtime hook callback failed|Unbalanced native controller asset URL evidence/', $error->getMessage())) throw $error;
        echo "Incomplete controller URL observations rejected publication after unchanged native output.\n";
        exit;
    }
    throw new RuntimeException('Incomplete controller URL observations were accepted');
}
$collector->finish();
$events = array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue());
$expected = [
    'asset-reference' => ['layout-asset-reference-rendered'],
    'asset-src' => ['layout-asset-controller-url-generated', 'layout-asset-reference-rendered'],
    'asset-src-type' => ['layout-asset-controller-url-generated', 'layout-asset-reference-rendered'],
    'asset-attribute-rel' => ['layout-asset-attribute-emitted'],
    'asset-order' => ['layout-asset-group-applied'],
];
if ($custom) $expected = array_fill_keys(array_keys($expected), ['layout-asset-controller-origin-unconfirmed']);
foreach ($file['declarations'] as $declaration) {
    $kind = $declaration['layout']['kind'];
    if (!isset($expected[$kind])) continue;
    $actual = array_values(array_unique(array_column(array_filter($events, static fn($row) => $row['id'] === $declaration['id']), 'type')));
    sort($actual);
    if ($actual !== $expected[$kind]) throw new RuntimeException('Controller asset effect differs at ' . $declaration['node'] . ': ' . implode(', ', $actual));
    unset($expected[$kind]);
}
if ($expected) throw new RuntimeException('Controller asset operand inventory changed');
echo "Verified original controller URL selection, group and rendered asset operands.\n";
