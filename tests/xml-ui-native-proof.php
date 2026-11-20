<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

use MageLens\UiProbe\Model\Provider;
use Magento\Framework\App\Area;
use Magento\Framework\App\AreaList;
use Magento\Framework\App\Bootstrap;
use Magento\Framework\App\State;
use Magento\Framework\View\Element\UiComponentFactory;
use Magento\Framework\View\Element\UiComponentInterface;
use Magento\Ui\Component\DataSource;
use Magento\Ui\Component\Form;
use Magento\Ui\Component\Form\Field;
use Magento\Ui\Component\Listing;
use Magento\Ui\Component\Listing\Columns\Column;

function verify(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function prepareTree(UiComponentInterface $component): void
{
    foreach ($component->getChildComponents() as $child) {
        prepareTree($child);
    }
    $component->prepare();
}

function renderedConfig(UiComponentInterface $component): array
{
    $recorder = \MageLens\XmlCoverage\Recorder::class;
    $numberDelivered = static fn(): int => class_exists($recorder, false)
        ? count(array_filter($recorder::$events, static fn(array $event): bool => $event[1] === 'ui-delivered'))
        : 0;
    $before = $numberDelivered();
    $html = (string) $component->render();
    verify($numberDelivered() === $before, 'Rendering without sending was treated as UI configuration delivery');
    $response = new \Magento\Framework\HTTP\PhpEnvironment\Response();
    ob_start();
    try {
        $response->setBody($html)->sendResponse();
        verify(ob_get_contents() === $html, 'Native response did not emit the generated UI markup');
    } finally {
        ob_end_clean();
    }
    $pattern = '~<script type="text/x-magento-init">(?:<!\[CDATA\[)?\s*(\{"\*":\s*\{"Magento_Ui/js/core/app":.*?\}\})\s*(?:\]\]>)?</script>~s';
    verify(preg_match($pattern, $html, $match) === 1, 'Native UI JavaScript configuration missing');
    $config = json_decode($match[1], true, flags: JSON_THROW_ON_ERROR);
    return $config['*']['Magento_Ui/js/core/app']['components'][$component->getName()]['children'];
}

function exercise(UiComponentFactory $factory): array
{
    $listing = $factory->create('magelens_ui_probe_listing');
    $form = $factory->create('magelens_ui_probe_form');
    verify($listing instanceof Listing && $form instanceof Form, 'Expected native listing and form');
    $columns = $listing->getComponent('probe_columns');
    $fields = $form->getComponent('probe_fields');
    $listingSource = $listing->getComponent('probe_data_source');
    $formSource = $form->getComponent('probe_form_data_source');
    verify($listingSource instanceof DataSource && $formSource instanceof DataSource, 'Expected native data sources');
    verify($columns->getComponent('disabled') === null, 'Disabled XML column was constructed');
    verify($fields->getComponent('uninstantiated') !== null, 'Client-disabled button missing from PHP tree');
    foreach (['untouched', 'equal', 'replaced'] as $name) {
        verify($columns->getComponent($name) instanceof Column, 'Native default column class not applied');
    }
    verify($fields->getComponent('untouched') instanceof Field, 'Native default field class not applied');

    $listingProvider = $listingSource->getDataProvider();
    $formProvider = $formSource->getDataProvider();
    verify($listingProvider instanceof Provider && $formProvider instanceof Provider, 'Expected configured providers');
    verify($listingProvider->calls() === ['meta'] && $formProvider->calls() === ['meta'], 'Data provider executed during construction');
    verify($listingProvider->getConfigData()['update_url'] !== '', 'Native update URL missing');

    prepareTree($listing);
    prepareTree($form);
    $labels = [];
    foreach (['untouched', 'equal', 'replaced'] as $name) {
        $label = $columns->getComponent($name)->getConfiguration()['label'];
        $labels[$name] = (string) $label;
    }
    verify($labels === [
        'untouched' => 'Untouched column',
        'equal' => 'Equal column',
        'replaced' => 'PHP replacement',
    ], 'Native overlay or modifier output differs');
    $fieldLabel = (string) $fields->getComponent('untouched')->getConfiguration()['label'];
    verify($fieldLabel === 'Untouched field', 'Native field preparation output differs');
    $listingConfig = renderedConfig($listing);
    $formConfig = renderedConfig($form);
    $grid = $listingConfig['magelens_ui_probe_listing']['children']['probe_columns']['children'];
    verify(array_keys($grid) === ['untouched', 'equal', 'replaced'], 'Rendered listing includes the wrong columns');
    $fields = $formConfig['magelens_ui_probe_form']['children']['probe_fields']['children'];
    verify(($fields['uninstantiated']['config']['componentDisabled'] ?? null) === true, 'Client-disabled component not delivered');
    $listingData = $listingConfig['probe_data_source']['config']['data'];
    $formData = $formConfig['probe_form_data_source']['config']['data'];
    verify(array_column($listingData['items'], 'id') === [1, 2], 'Listing output differs');
    verify($formData === ['untouched' => 'Fixture value'], 'Form output differs');
    verify($listingProvider->calls() === ['meta', 'page', 'data'], 'Unexpected listing provider calls: ' . implode(', ', $listingProvider->calls()));
    verify($formProvider->calls() === ['meta', 'filter', 'data'], 'Unexpected form provider calls: ' . implode(', ', $formProvider->calls()));
    $recorder = \MageLens\XmlCoverage\Recorder::class;
    $before = class_exists($recorder, false) ? $recorder::$events : null;
    verify($listingProvider->getData() === $listingData, 'Direct provider call returned different fixture data');
    verify($before === null || $recorder::$events === $before, 'Direct provider call credited a UI XML binding');
    return [
        'columns' => $labels,
        'field' => $fieldLabel,
        'listing' => $listingData,
        'form' => $formData,
        'providerCalls' => [$listingProvider->calls(), $formProvider->calls()],
    ];
}

$app = $argv[1] ?? '/var/www/html';
$collector = in_array('--collect', $argv, true) || in_array('--expect-cache-only', $argv, true);
$cacheOnly = in_array('--expect-cache-only', $argv, true);
if ($collector) {
    require_once __DIR__ . '/xml-ui-collector-proof.php';
    $files = \MageLens\XmlCoverage\startUiProof(
        $app,
        dirname(getenv('MAGELENS_XML_HOOKS') ?: dirname(__DIR__) . '/docker/php/xml-hooks.php'),
        $argv[3] ?? bin2hex(random_bytes(16))
    );
}
require $app . '/app/bootstrap.php';
$om = Bootstrap::create(BP, $_SERVER)->getObjectManager();
$om->get(State::class)->setAreaCode(Area::AREA_ADMINHTML);
$om->get(\Magento\Store\Model\StoreManagerInterface::class)->setCurrentStore("admin");
$om->get(AreaList::class)->getArea(Area::AREA_ADMINHTML)->load(Area::PART_CONFIG);
if (in_array('--clear-fixture-cache', $argv, true)) {
    $cache = $om->get(\Magento\Framework\Config\CacheInterface::class);
    foreach (['listing', 'form', 'unopened'] as $screen) {
        $cache->remove(\Magento\Ui\Config\Data::CACHE_ID . '_magelens_ui_probe_' . $screen);
    }
    exit;
}
$result = exercise($om->get(UiComponentFactory::class));
if ($collector) {
    \MageLens\XmlCoverage\verifyUiEvidence($files, \MageLens\XmlCoverage\Recorder::$events, $cacheOnly);
    \MageLens\XmlCoverage\Recorder::$events = [];
}
verify(exercise($om->get(UiComponentFactory::class)) === $result, 'Warm configuration changed native output or application calls');
if ($collector) {
    \MageLens\XmlCoverage\verifyUiEvidence($files, \MageLens\XmlCoverage\Recorder::$events, $cacheOnly);
}
echo hash('sha256', json_encode($result, JSON_THROW_ON_ERROR)), PHP_EOL;
