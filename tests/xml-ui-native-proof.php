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
use Magento\Framework\Component\ComponentRegistrar;
use Magento\Framework\Data\Form\FormKey;
use Magento\Framework\View\DesignInterface;
use Magento\Framework\View\Element\UiComponentFactory;
use Magento\Framework\View\Element\UiComponentInterface;
use Magento\Ui\Component\DataSource;
use Magento\Ui\Component\Form;
use Magento\Ui\Component\Form\Field;
use Magento\Ui\Component\Listing;
use Magento\Ui\Component\Listing\Columns\Column;

const UI_PROOF_THEMES = [
    'adminhtml/MageLens/ui-proof' => 'app/design/adminhtml/MageLens/ui-proof',
    'adminhtml/MageLens/ui-composer-proof' => 'vendor/magelens/ui-composer-proof',
];

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
    $recording = function_exists('MageLens\\XmlCoverage\\uiProofEvents');
    $numberDelivered = static fn(): int => $recording
        ? count(array_filter(\MageLens\XmlCoverage\uiProofEvents(), static fn(array $event): bool => $event['type'] === 'ui-delivered'))
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
    return [$config['*']['Magento_Ui/js/core/app']['components'][$component->getName()]['children'], hash('sha256', $html)];
}

function providerOutcomes(UiComponentFactory $factory): array
{
    $output = [];
    $recording = function_exists('MageLens\\XmlCoverage\\uiProofEvents');
    foreach (['throws', 'catches'] as $case) {
        $name = 'probe_provider_' . $case;
        $listing = $factory->create('magelens_ui_' . $name);
        $provider = $listing->getComponent($name)->getDataProvider();
        $invoke = static function (callable $getData) use ($case): array|string {
            try {
                $result = $getData();
                verify($case === 'catches', 'Configured override did not throw');
                return $result;
            } catch (RuntimeException $error) {
                verify($case === 'throws' && $error->getMessage() === 'Configured override failed', 'Wrong provider exception');
                return $error->getMessage();
            }
        };
        $before = $recording ? \MageLens\XmlCoverage\uiProofEvents() : null;
        $direct = $invoke($provider->getData(...));
        verify($before === null || \MageLens\XmlCoverage\uiProofEvents() === $before, 'Direct inherited provider call credited a UI XML binding');
        $native = $invoke($listing->getDataSourceData(...));
        verify($native === ($case === 'catches' ? ['data' => $direct] : $direct), 'Native provider outcome differs');
        verify($provider->calls() === ['meta', 'data', 'data'], 'Native provider changed the parent call count');
        $output[$case] = [$native, $provider->calls()];
    }
    return $output;
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
    $expectedLabels = [
        'untouched' => 'Untouched column',
        'equal' => 'Equal column',
        'replaced' => 'PHP replacement',
        'before_different' => 'Before prepare replacement',
        'before_equal' => 'Equal PHP column',
        'after_prepare' => 'After prepare replacement',
        'theme_label' => 'Composer Admin theme label',
        'after_configuration' => 'Serialized replacement',
    ];
    foreach (array_keys($expectedLabels) as $name) {
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
    verify($columns->getComponent('after_configuration')->getData('config')['label'] === 'Original serialized label',
        'The after plugin must leave the native component label intact');
    $labels = [];
    foreach (array_keys($expectedLabels) as $name) {
        $label = $columns->getComponent($name)->getConfiguration()['label'];
        $labels[$name] = (string) $label;
    }
    verify($labels === $expectedLabels, 'Native overlay or PHP label output differs: ' . json_encode($labels, JSON_THROW_ON_ERROR));
    $fieldLabel = (string) $fields->getComponent('untouched')->getConfiguration()['label'];
    verify($fieldLabel === 'Untouched field', 'Native field preparation output differs');
    [$listingConfig, $listingMarkup] = renderedConfig($listing);
    [$formConfig, $formMarkup] = renderedConfig($form);
    $grid = $listingConfig['magelens_ui_probe_listing']['children']['probe_columns']['children'];
    verify(array_keys($grid) === array_keys($expectedLabels), 'Rendered listing includes the wrong columns');
    foreach ($grid as $name => $column) {
        verify($column['config']['label'] === $expectedLabels[$name], 'Serialized label differs for ' . $name);
    }
    $fields = $formConfig['magelens_ui_probe_form']['children']['probe_fields']['children'];
    verify($fields['readonly']['config']['elementTmpl'] === 'ui/form/element/text', 'Native read-only field template differs');
    verify(($fields['uninstantiated']['config']['componentDisabled'] ?? null) === true, 'Client-disabled component not delivered');
    $listingData = $listingConfig['probe_data_source']['config']['data'];
    $formData = $formConfig['probe_form_data_source']['config']['data'];
    verify(array_column($listingData['items'], 'id') === [1, 2], 'Listing output differs');
    verify($formData === ['untouched' => 'Fixture value', 'readonly' => 'Read-only fixture value'], 'Form output differs');
    verify($listingProvider->calls() === ['meta', 'page', 'data'], 'Unexpected listing provider calls: ' . implode(', ', $listingProvider->calls()));
    verify($formProvider->calls() === ['meta', 'filter', 'data'], 'Unexpected form provider calls: ' . implode(', ', $formProvider->calls()));
    $recording = function_exists('MageLens\\XmlCoverage\\uiProofEvents');
    $before = $recording ? \MageLens\XmlCoverage\uiProofEvents() : null;
    verify($listingProvider->getData() === $listingData, 'Direct provider call returned different fixture data');
    verify($before === null || \MageLens\XmlCoverage\uiProofEvents() === $before, 'Direct provider call credited a UI XML binding');
    return [
        'columns' => $labels,
        'field' => $fieldLabel,
        'listing' => $listingData,
        'form' => $formData,
        'providerCalls' => [$listingProvider->calls(), $formProvider->calls()],
        'inheritedProvider' => providerOutcomes($factory),
        'markup' => [$listingMarkup, $formMarkup],
    ];
}

$app = $argv[1] ?? '/var/www/html';
$mode = $argv[2] ?? '';
$collector = in_array($mode, ['--collect', '--collect-warm', '--expect-cache-only'], true);
require $app . '/app/bootstrap.php';
foreach (UI_PROOF_THEMES as $theme => $path) {
    ComponentRegistrar::register(ComponentRegistrar::THEME, $theme, BP . '/' . $path);
}
if ($collector) {
    require_once __DIR__ . '/xml-ui-collector-proof.php';
    $files = \MageLens\XmlCoverage\startUiProof(
        $app,
        dirname(getenv('MAGELENS_XML_HOOKS') ?: dirname(__DIR__) . '/docker/php/xml-hooks.php'),
        $argv[3] ?? bin2hex(random_bytes(16))
    );
}
$om = Bootstrap::create(BP, $_SERVER)->getObjectManager();
$clearFixtureCache = $mode === '--clear-fixture-cache';
$theme = null;
if (!$clearFixtureCache) {
    foreach (['Magento/backend', 'MageLens/ui-proof', 'MageLens/ui-composer-proof'] as $path) {
        $theme = $om->create(\Magento\Theme\Model\Theme::class, ['data' => [
            'area' => Area::AREA_ADMINHTML, 'theme_path' => $path, 'parent_theme' => $theme,
        ]]);
    }
    // Select the disposable theme before the Admin area enables the Mage-OS theme switcher.
    $om->get(DesignInterface::class)->setDesignTheme($theme, Area::AREA_ADMINHTML);
}
$om->get(State::class)->setAreaCode(Area::AREA_ADMINHTML);
$om->get(\Magento\Store\Model\StoreManagerInterface::class)->setCurrentStore('admin');
$om->get(AreaList::class)->getArea(Area::AREA_ADMINHTML)->load(Area::PART_CONFIG);
if ($clearFixtureCache) {
    $cache = $om->get(\Magento\Framework\Config\CacheInterface::class);
    foreach (['listing', 'form', 'unopened', 'provider_throws', 'provider_catches'] as $screen) {
        $cache->remove(\Magento\Ui\Config\Data::CACHE_ID . '_magelens_ui_probe_' . $screen);
    }
    exit;
}
verify($om->get(DesignInterface::class)->getDesignTheme() === $theme, 'Native Admin design did not retain the fixture theme');
// Use the same session input to native Admin URL signing when comparing the full markup.
$om->get(FormKey::class)->set('MageLensFixture1');
$result = exercise($om->get(UiComponentFactory::class));
if ($collector) {
    \MageLens\XmlCoverage\verifyUiEvidence($files, $mode, $argv[3], false);
    \MageLens\XmlCoverage\uiProofEvents(true);
}
verify(exercise($om->get(UiComponentFactory::class)) === $result, 'Warm configuration changed native output or application calls');
if ($collector) {
    \MageLens\XmlCoverage\verifyUiEvidence($files, $mode, $argv[3], true);
}
echo hash('sha256', json_encode($result, JSON_THROW_ON_ERROR)), PHP_EOL;
