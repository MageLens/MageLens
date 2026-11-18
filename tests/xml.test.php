<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
require __DIR__ . '/../docker/php/xml-manifest.php';
use MageLens\XmlCoverage\{LayoutManifest, Xml};
function checkXml(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
$unsafe = new class {
    public function __serialize(): array { throw new LogicException('Application serialization executed'); }
};
checkXml(Xml::scalarTreeSignature(['nested' => ['unsafe' => $unsafe]]) === null,
    'Runtime signatures reject objects without invoking application serialization');
$cycle = [];
$cycle['self'] = &$cycle;
set_error_handler(static function ($severity, $message): never { throw new RuntimeException($message); });
try {
    checkXml(Xml::scalarTreeSignature($cycle) === null, 'Recursive runtime data has no scalar signature');
} finally {
    restore_error_handler();
}
checkXml(Xml::scalarTreeSignature(['value' => ['false' => false, 'null' => null]]) !== null,
    'Runtime signatures preserve nested scalar types');
require_once __DIR__ . '/../docker/php/xml-layout.php';
$fingerprint = new ReflectionMethod(\MageLens\XmlCoverage\LayoutCoverage::class, 'valueFingerprint');
$matches = new ReflectionMethod(\MageLens\XmlCoverage\LayoutCoverage::class, 'matchesFingerprint');
$objectIdentity = $fingerprint->invoke(null, $unsafe);
checkXml($matches->invoke(null, $objectIdentity, $unsafe)
    && !$matches->invoke(null, $objectIdentity, clone $unsafe), 'Object identity preserves shared and fresh lifetimes without serialization');
checkXml($fingerprint->invoke(null, $cycle) === null
    && $fingerprint->invoke(null, array_fill(0, 1025, 'value')) === null
    && $fingerprint->invoke(null, str_repeat('x', 65537)) === null, 'Argument identity tracing is bounded by depth, nodes and bytes');
$arrayIdentity = $fingerprint->invoke(null, ['value' => false, 'object' => $unsafe]);
checkXml($matches->invoke(null, $arrayIdentity, ['value' => false, 'object' => $unsafe])
    && !$matches->invoke(null, $arrayIdentity, ['object' => $unsafe, 'value' => false])
    && !$matches->invoke(null, $arrayIdentity, ['value' => 0, 'object' => $unsafe]), 'Array identities preserve order, keys and scalar types');
$stream = fopen('php://temp', 'w+');
$streamIdentity = $fingerprint->invoke(null, $stream);
checkXml($matches->invoke(null, $streamIdentity, $stream), 'Open resource identity requires the native handle');
fclose($stream);
checkXml(!$matches->invoke(null, $streamIdentity, $stream) && $fingerprint->invoke(null, $stream) === null,
    'Closed resources cannot retain a live argument identity');
$config = __DIR__ . '/../src/app/code/Application/Blog/Test/Configuration/fixtures/etc/config.xml';
$source = file_get_contents($config);
$items = Xml::declarations('app/code/Application/Blog/etc/config.xml', $source, 'config');
checkXml(count($items) === 13, 'Inventory all default, website and store leaves');
$headings = array_values(array_filter($items, static fn($item) => $item['path'] === 'application_blog/display/heading'));
checkXml(count($headings) === 3, 'Scoped paths remain distinct');
checkXml(count(array_unique(array_column($headings, 'id'))) === 3, 'Stable IDs include declared scope');
foreach ($headings as $item) checkXml(str_contains(explode("\n", $source)[$item['startLine'] - 1], '<heading>'), 'Exact scoped source line');
$multi = array_values(array_filter($items, static fn($item) => str_ends_with($item['path'], '/multiline')))[0];
checkXml($multi['endLine'] - $multi['startLine'] === 3, 'CDATA inclusive source range');
checkXml(Xml::declarations('app/code/Application/Blog/etc/config.xml', str_replace("\n", "\r\n", $source), 'config') === $items, 'CRLF does not change line maps');
$dom = Xml::document('<config><!-- <ignored/> --><leaf title="a > b"><![CDATA[<fake/>]]></leaf><empty/></config>');
checkXml(count(Xml::ranges($dom->saveXML(), $dom)) === 3, 'Comments, quoted > and CDATA are not XML elements');
foreach (['<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><x>&x;</x>', '<config><broken></config>'] as $invalid) {
    try { Xml::document($invalid); throw new LogicException('Invalid input accepted'); }
    catch (RuntimeException $expected) {}
}
$system = file_get_contents(__DIR__ . '/../src/app/code/Application/Blog/Test/Configuration/fixtures/etc/adminhtml/system.xml');
$fields = Xml::declarations('app/code/Application/Blog/etc/adminhtml/system.xml', $system, 'system');
checkXml(count($fields) === 5, 'Inventory hidden and unopened fields as well as rendered fields');
checkXml(count(array_unique(array_column($fields, 'id'))) === 5, 'Shared config_path does not collapse fields');
checkXml(Xml::mask(['a' => ['x' => 'secret', 'y' => null]]) === ['a' => ['x' => '__magelens_external__', 'y' => '__magelens_external__']], 'External overrides retain ownership even for null/equal values');

$themeSources = ['fixture.xml' => '<config><default><design><theme><theme_id>frontend/Magento/blank</theme_id></theme></design></default>'
    . '<websites><base><design><theme><theme_id>7</theme_id></theme></design></base></websites>'
    . '<stores><reading><design><theme><theme_id><![CDATA[frontend/Magento/blank]]></theme_id></theme></design></reading></stores></config>'];
$themeSymbols = Xml::symbolicSources($themeSources, []);
checkXml(count($themeSymbols['unmeasured']) === 3, 'Every native theme transformation has an explicit provenance limitation');
$themeDocument = Xml::document($themeSymbols['sources']['fixture.xml']);
checkXml(array_map(static fn($node) => $node->textContent,
    iterator_to_array((new DOMXPath($themeDocument))->query('//theme_id')))
    === ['frontend/Magento/blank', '7', 'frontend/Magento/blank'], 'Disposable symbolic inputs preserve native theme values and CDATA');
$themeData = ['default' => ['design' => ['theme' => ['theme_id' => 'frontend/Magento/blank']], 'secret' => 'hidden'],
    'stores' => ['reading' => ['design' => ['theme' => ['theme_id' => 7]], 'secret' => 'hidden']],
    'websites' => ['base' => ['design' => ['theme' => ['theme_id' => null]]]]];
$maskedThemes = Xml::maskConfiguration($themeData);
checkXml($maskedThemes['default']['design'] === $themeData['default']['design']
    && $maskedThemes['stores']['reading']['design'] === $themeData['stores']['reading']['design']
    && $maskedThemes['websites'] === $themeData['websites']
    && $maskedThemes['default']['secret'] === '__magelens_external__'
    && $maskedThemes['stores']['reading']['secret'] === '__magelens_external__',
    'External sources preserve only native transformed theme values while masking other scalar data');

$fields[1]['supported'] = false;
$shared = ['run' => 'test', 'observers' => ['global' => ['event' => ['hash' => 'observer-hash']]]];
$path = $headings[0]['path'];
[$report, $collector] = xmlManifestPayloads($shared, [
    'files' => [['declarations' => $headings], ['declarations' => $fields]],
    'origins' => ["default/$path" => 'default-id', "stores/reading/$path" => 'store-id'],
    'valueHashes' => ["default/$path" => 'default-hash', "stores/reading/$path" => 'store-hash'],
]);
checkXml($collector['id'] === $report['id'] && $collector['observers'] === $report['observers'],
    'Report and collector share the same manifest identity and observer registrations');
checkXml($collector['paths'] === ['' => true, $path => true, 'application_blog/display' => true, 'application_blog' => true],
    'Collector includes supported configuration paths and their ancestors');
checkXml($collector['fields'][$fields[0]['path']] === [$fields[0]['id']] && !isset($collector['fields'][$fields[1]['path']]),
    'Collector includes supported fields only');
checkXml($collector['originScopes'] === ['default' => [$path => 'default-id'], 'stores/reading' => [$path => 'store-id']]
    && $collector['valueHashes'] === ['default' => [$path => 'default-hash'], 'stores/reading' => [$path => 'store-hash']],
    'Collector indexes matching origin IDs and hashes by scope and path');
$layoutDirectory = __DIR__ . '/fixtures/compatibility/module/view/frontend/layout/';
$originFile = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_layout_base.xml';
$layoutSource = file_get_contents($layoutDirectory . basename($originFile));
$layoutItems = LayoutManifest::declarations($originFile, $layoutSource);
$hint = array_values(array_filter($layoutItems, static fn($item) => $item['layout']['attribute'] === 'xsi:noNamespaceSchemaLocation'))[0];
checkXml(!$hint['supported'] && $hint['layout']['kind'] === 'schema-hint'
    && str_contains($hint['reason'], 'Native file packaging omits this namespaced schema hint'),
    'Source schema hints retain their native packaging limitation');
$aliasedHint = LayoutManifest::declarations('app/code/Fixture/Module/view/frontend/layout/hint.xml',
    '<layout xmlns:grammar="http://www.w3.org/2001/XMLSchema-instance" grammar:noNamespaceSchemaLocation="fixture.xsd"/>');
checkXml($aliasedHint[1]['layout']['kind'] === 'schema-hint' && !$aliasedHint[1]['supported']
    && $aliasedHint[1]['layout']['attribute'] === 'grammar:noNamespaceSchemaLocation',
    'Schema-hint identity preserves the original namespace prefix while semantics use the namespace URI');
foreach ([['layout', 'page', 'page'], ['layout', 'layout', 'generic'], ['page_layout', 'layout', 'wireframe']] as [$directory, $root, $type]) {
    foreach (['', ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="unused.xsd"'] as $hintAttribute) {
        $declarations = LayoutManifest::declarations("app/code/Fixture/Module/view/frontend/$directory/hint.xml", "<$root$hintAttribute/>");
        checkXml($declarations[0]['layout']['fileType'] === $type,
            'Native file role and root determine the layout inventory independently of omitted source hints');
    }
}
$moveItems = LayoutManifest::declarations('app/code/Fixture/Module/view/frontend/layout/move.xml',
    '<layout><move element="source" destination="target" as="alias" before="first" after="last"/></layout>');
$moveItems = array_values(array_filter($moveItems, static fn($item) => $item['layout']['instruction'] === 'move'));
checkXml(array_column(array_column($moveItems, 'layout'), 'kind') === ['move', 'move-element', 'move-destination', 'move-as', 'move-before', 'move-after']
    && count(array_filter($moveItems, static fn($item) => $item['supported'])) === 6,
    'Each native move operand has its own stable supported source identity');
$replaced = array_values(array_filter($layoutItems, static fn($item) => $item['layout']['element'] === 'magelens.layout.replaced' && $item['supported']));
checkXml(array_column(array_column($replaced, 'layout'), 'kind') === ['block', 'block-class', 'position-name', 'template'],
    'Block, class, name and template origins are independent');
checkXml(count(array_unique(array_column($replaced, 'id'))) === 4
    && count(array_unique(array_column($replaced, 'startLine'))) === 1, 'Separate original effects share their source line');
checkXml($replaced[0]['path'] . '/@class' === $replaced[1]['path'], 'Class location retains the original attribute');
checkXml($replaced[0]['path'] . '/@template' === $replaced[3]['path'], 'Template location retains the original attribute');
checkXml(LayoutManifest::declarations($originFile, str_replace("\n", "\r\n", $layoutSource)) === $layoutItems, 'Layout source maps preserve original positions across line endings');
$layoutUnsupported = array_values(array_filter($layoutItems, static fn($item) => !$item['supported']));
checkXml(count($layoutUnsupported) > 0 && count(array_filter($layoutUnsupported, static fn($item) => !$item['reason'])) === 0,
    'Layout declarations without runtime observations retain a reason');
$arraySource = file_get_contents($layoutDirectory . 'coverageprobe_layout_arguments.xml');
$arrayItems = LayoutManifest::declarations(dirname($originFile) . '/coverageprobe_layout_arguments.xml', $arraySource);
$leaves = array_values(array_filter($arrayItems, static fn($item) =>
    $item['layout']['instruction'] === 'item' && $item['supported']));
checkXml(count($leaves) === 9 && count(array_unique(array_column($leaves, 'id'))) === 9,
    'Array parents and leaves retain separate original declarations');
foreach ($leaves as $leaf) {
    checkXml($leaf['layout']['kind'] === 'argument' && str_contains($leaf['path'], '/item'),
        'Array leaf evidence uses the layout argument application boundary');
}
$registrySource = file_get_contents(__DIR__ . '/fixtures/compatibility/module/view/frontend/layouts.xml');
$registryItems = LayoutManifest::declarations('app/code/MageLens/Compatibility/view/frontend/layouts.xml', $registrySource);
$registryKinds = array_column(array_column($registryItems, 'layout'), 'kind');
checkXml(array_slice($registryKinds, 2, 4) === ['registry-entry', 'registry-id', 'registry-label', 'attribute'],
    'Registry entries, ID attributes, labels and unused translation flags have distinct identities');
$registryFlag = $registryItems[5];
checkXml(!$registryFlag['supported'] && str_contains($registryFlag['reason'], 'flag'),
    'Registry translation flags retain the native ignored-flag limitation');
echo "XML parsing, source maps, scopes and field identities passed.\n";

require __DIR__ . '/configuration-fixture.test.php';

$bindingCollector = (new ReflectionClass(\MageLens\XmlCoverage\LayoutCoverage::class))->newInstanceWithoutConstructor();
$bindLeaves = new ReflectionMethod($bindingCollector, 'bindArgumentLeaves');
$digest = new ReflectionMethod($bindingCollector, 'digest');
$oldLeaf = ['id' => 'old-leaf', 'digest' => $digest->invoke(null, ['same'])];
$replacedLeaf = $bindLeaves->invoke($bindingCollector, ['value' => []], ['value' => 'same'], ['value' => $oldLeaf], ['value' => true]);
checkXml(($replacedLeaf['value']['overridden'] ?? []) === ['old-leaf'] && !isset($replacedLeaf['value']['id']),
    'Equal-valued programmatic scalar updates retain the displaced XML origin without application credit');
$oldArray = ['pending' => ['id' => 'old-parent', 'input' => $fingerprint->invoke(null, ['changed' => 'same', 'surviving' => 'same'])],
    'children' => ['changed' => $oldLeaf, 'surviving' => ['id' => 'surviving-leaf', 'digest' => $oldLeaf['digest']]]];
$mixedArray = $bindLeaves->invoke($bindingCollector, ['value' => ['children' => ['changed' => []]]],
    ['value' => ['changed' => 'same', 'surviving' => 'same']], ['value' => $oldArray], ['value' => true]);
checkXml(($mixedArray['value']['mixed'] ?? []) === ['old-parent']
    && ($mixedArray['value']['children']['changed']['overridden'] ?? []) === ['old-leaf']
    && ($mixedArray['value']['children']['surviving']['id'] ?? null) === 'surviving-leaf',
    'Mixed programmatic arrays retain the parent limitation, displaced leaf and independent surviving leaf');
foreach ([[], ['id' => 'new-scalar']] as $newOrigin) {
    $replacedArray = $bindLeaves->invoke($bindingCollector, ['value' => $newOrigin], ['value' => 'same'],
        ['value' => $oldArray], ['value' => true]);
    checkXml(($replacedArray['value']['overridden'] ?? []) === ['old-parent', 'old-leaf', 'surviving-leaf']
        && !isset($replacedArray['value']['children']), 'Scalar replacement accounts for every displaced original array declaration');
}
echo "Programmatic argument overlays preserve displaced and surviving XML origins.\n";
