<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
require (require __DIR__ . '/project-root.php') . '/docker/php/xml-manifest.php';
require_once (require __DIR__ . '/project-root.php') . '/docker/php/xml-routing-runtime.php';
use MageLens\XmlCoverage\{FamilyEvidence, LayoutManifest, RoutingRuntime, Xml};
function checkXml(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
$themeRoots = Xml::registeredThemeAreas([
    'adminhtml/MageLens/probe' => '/app/app/design/adminhtml/MageLens/probe',
    'adminhtml/Acme/probe' => '/app/vendor/acme/admin-theme',
    'frontend/Acme/probe' => '/app/vendor/acme/store-theme',
    'adminhtml/Other/probe' => '/external/theme',
], '/app');
checkXml(!in_array('/external/theme', array_keys($themeRoots), true) && count($themeRoots) === 3, 'Only registered application theme roots are in scope');
$listFile = 'magelens_ui_probe_listing.xml';
$uiBytes = file_get_contents(__DIR__ . '/fixtures/ui-module/themes/local/MageLens_UiProbe/ui_component/' . $listFile);
$uiModule = "app/code/MageLens/UiProbe/view/adminhtml/ui_component/$listFile";
$uiTheme = "app/design/adminhtml/MageLens/probe/MageLens_UiProbe/ui_component/$listFile";
$uiComposer = "vendor/acme/admin-theme/MageLens_UiProbe/ui_component/$listFile";
$stripId = static fn(array $item): array => array_diff_key($item, ['id' => true]);
$uiExpected = FamilyEvidence::inventory($uiModule, $uiBytes)['declarations'];
checkXml(count($uiExpected) === 2 && $uiExpected[1]['startLine'] === 12, 'Module UI declarations retain original label lines');
foreach ([$uiTheme, $uiComposer] as $uiPath) {
    $uiActual = FamilyEvidence::inventory($uiPath, $uiBytes, $themeRoots)['declarations'] ?? [];
    checkXml(array_map($stripId, $uiExpected) === array_map($stripId, $uiActual)
        && $uiExpected[1]['id'] !== $uiActual[1]['id'], 'Admin theme declaration matches the module shape and keeps its own source identity');
}
checkXml(FamilyEvidence::inventory($uiComposer, $uiBytes) === null, 'An unregistered theme path cannot be inferred from a vendor package name');
$uiBase = str_replace('/view/adminhtml/', '/view/base/', $uiModule);
checkXml((FamilyEvidence::inventory($uiBase, $uiBytes)['declarations'][1]['declaredScope']['type'] ?? null) === 'global',
    'Base module UI declarations keep global scope');
$uiVendorModule = str_replace('app/code/MageLens/UiProbe/', 'vendor/acme/ui-probe/', $uiModule);
checkXml((FamilyEvidence::inventory($uiVendorModule, $uiBytes)['declarations'][1]['declaredScope']['type'] ?? null) === 'adminhtml',
    'Vendor module UI declarations keep Admin scope');
foreach ([str_replace('/admin-theme/', '/store-theme/', $uiComposer), str_replace('/adminhtml/', '/frontend/', $uiModule),
    str_replace('/adminhtml/', '/frontend/', $uiTheme)] as $uiPath) {
    checkXml(FamilyEvidence::inventory($uiPath, $uiBytes, $themeRoots) === null, 'Standalone frontend UI components are excluded');
}
foreach ([str_replace('/MageLens_UiProbe/', '/UiProbe/', $uiTheme),
    str_replace('/ui_component/', '/ui_component/nested/', $uiComposer),
    str_replace($listFile, 'invalid.name.xml', $uiModule)] as $uiPath) {
    checkXml(FamilyEvidence::inventory($uiPath, $uiBytes, $themeRoots) === null, 'UI files require a recognized directory and component name');
}
foreach ([[123, '123'], ['123', '123'], ['0123', '0123'], ['catalogue', 'catalogue']] as [$input, $expected]) {
    checkXml(RoutingRuntime::identifier($input) === $expected, 'Native route IDs preserve string identity');
}
foreach ([false, null, 123.0, [], new stdClass()] as $input) {
    checkXml(RoutingRuntime::identifier($input) === null, 'Unrelated types cannot identify a native route');
}
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
require_once (require __DIR__ . '/project-root.php') . '/docker/php/xml-layout.php';
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
$config = (require __DIR__ . '/project-root.php') . '/src/app/code/Application/Blog/Test/Configuration/fixtures/etc/config.xml';
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
$system = file_get_contents((require __DIR__ . '/project-root.php') . '/src/app/code/Application/Blog/Test/Configuration/fixtures/etc/adminhtml/system.xml');
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
checkXml($collector['paths'] === ['' => false, 'design/theme' => true, 'design' => false,
    'admin/system_admin_design/active_theme' => true, 'admin/system_admin_design' => false, 'admin' => false,
    $path => true, 'application_blog/display' => false, 'application_blog' => false],
    'Collector distinguishes supported configuration paths and theme selection from their ancestors');
checkXml(Xml::configurationAffects($collector['paths'], 'admin/system_admin_design/active_theme')
    && Xml::configurationAffects($collector['paths'], 'admin/system_admin_design')
    && !Xml::configurationAffects($collector['paths'], 'admin/system_admin_design/runtime_state'),
    'The Mage-OS Admin theme source is guarded without an inventoried declaration, including ancestor writes');
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
foreach (['typeprefix', 'typelocalprefix'] as $variant) {
    $file = 'coverageprobe_grammar_' . $variant . '.xml';
    $declarations = LayoutManifest::declarations(dirname($originFile) . '/' . $file, file_get_contents($layoutDirectory . $file));
    $type = array_values(array_filter($declarations, static fn($item) => $item['layout']['attribute'] === 'typed:type'))[0];
    checkXml(!$type['supported'] && str_contains($type['reason'], 'literal xsi prefix')
        && str_contains($type['reason'], 'discarded before argument interpretation'),
        'Namespace-equivalent type attributes retain the verified native serialization limitation');
}
foreach ([['layout', 'page', 'page'], ['layout', 'layout', 'generic'], ['page_layout', 'layout', 'wireframe']] as [$directory, $root, $type]) {
    foreach (['', ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="unused.xsd"'] as $hintAttribute) {
        $declarations = LayoutManifest::declarations("app/code/Fixture/Module/view/frontend/$directory/hint.xml", "<$root$hintAttribute/>");
        checkXml($declarations[0]['layout']['fileType'] === $type,
            'Native file role and root determine the layout inventory independently of omitted source hints');
    }
}
$serviceItems = LayoutManifest::declarations(dirname($originFile) . '/coverageprobe_grammar_serviceurl.xml',
    file_get_contents($layoutDirectory . 'coverageprobe_grammar_serviceurl.xml'));
foreach ($serviceItems as $item) if ($item['layout']['instruction'] === 'param') {
    checkXml(!$item['supported'] && str_contains($item['reason'], 'ServiceUrl') && str_contains($item['reason'], 'ignores'),
        'Ignored service URL parameters retain their precise native consumer limitation');
}
foreach (['enabled', 'order'] as $variant) {
    $updaterItems = LayoutManifest::declarations(dirname($originFile) . '/coverageprobe_grammar_updater' . $variant . '.xml',
        file_get_contents($layoutDirectory . 'coverageprobe_grammar_updater' . $variant . '.xml'));
    foreach ($updaterItems as $item) if ($item['layout']['instruction'] === 'updater' && $item['layout']['attribute'] !== null) {
        checkXml(!$item['supported'] && str_contains($item['reason'], 'array') && str_contains($item['reason'], 'TypeError'),
            'Updater modifiers retain the native array-class lookup failure rather than claiming flag or ordering effects');
    }
}
$moveItems = LayoutManifest::declarations('app/code/Fixture/Module/view/frontend/layout/move.xml',
    '<layout><move element="source" destination="target" as="alias" before="first" after="last"/></layout>');
$moveItems = array_values(array_filter($moveItems, static fn($item) => $item['layout']['instruction'] === 'move'));
checkXml(array_column(array_column($moveItems, 'layout'), 'kind') === ['move', 'move-element', 'move-destination', 'move-as', 'move-before', 'move-after']
    && count(array_filter($moveItems, static fn($item) => $item['supported'])) === 6,
    'Each native move operand has its own stable supported source identity');
$referencePath = 'app/code/Fixture/Module/view/frontend/layout/references.xml';
$referenceSource = '<layout xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><referenceContainer name="parent" htmlClass="outer"><block name="child" template="child.phtml">'
    . '<arguments><argument name="childValue" xsi:type="string">child</argument></arguments></block>'
    . '<referenceBlock name="inner" template="inner.phtml"/></referenceContainer><referenceBlock name="empty"/></layout>';
$referenceItems = LayoutManifest::declarations($referencePath, $referenceSource);
$referenceTargets = LayoutManifest::targets([['path' => $referencePath, 'family' => 'layout',
    'sourceHash' => hash('sha256', $referenceSource), 'declarations' => $referenceItems]])[$referencePath]['targets'];
$references = array_values(array_filter($referenceTargets, static fn($target) => isset($target['reference'])));
checkXml(count($references) === 3 && !$references[0]['reference']['empty'] && !$references[1]['reference']['empty']
    && $references[2]['reference']['empty'], 'References preserve independent node/name identities and empty-operation inventory');
foreach ($referenceItems as $item) {
    if (!$item['supported']) continue;
    $target = $referenceTargets[$item['layout']['ordinal']];
    if ($item['layout']['kind'] === 'container-htmlClass') {
        checkXml(($target['referenceOwner'] ?? null) === $references[0]['reference']['id'],
            'Direct reference attributes retain the enclosing original reference origin');
    } elseif (str_contains($item['path'], '/block[')) {
        checkXml(!isset($target['referenceOwner']), 'Child declaration effects do not credit an enclosing reference target');
    } elseif ($item['layout']['kind'] === 'template' && $item['layout']['element'] === 'inner') {
        checkXml(($target['referenceOwner'] ?? null) === $references[1]['reference']['id'],
            'Nested references begin independent effect ownership scopes');
    }
}
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
    $item['layout']['instruction'] === 'item' && $item['layout']['kind'] === 'argument' && $item['supported']));
checkXml(count($leaves) === 9 && count(array_unique(array_column($leaves, 'id'))) === 9,
    'Array parents and leaves retain separate original declarations');
foreach ($leaves as $leaf) {
    checkXml($leaf['layout']['kind'] === 'argument' && str_contains($leaf['path'], '/item'),
        'Array leaf evidence uses the layout argument application boundary');
}
$groupSource = file_get_contents($layoutDirectory . 'coverageprobe_argumentgroups.xml');
$groupItems = LayoutManifest::declarations(dirname($originFile) . '/coverageprobe_argumentgroups.xml', $groupSource);
$groups = array_values(array_filter($groupItems, static fn($item) => $item['layout']['kind'] === 'argument-group'));
checkXml(count($groups) === 4 && count(array_filter($groups, static fn($item) => !$item['supported'])) === 0,
    'Repeated argument groups retain independent original carrier identities');
$emptyGroups = LayoutManifest::declarations($originFile, '<layout><block><arguments/></block></layout>');
$emptyGroup = array_values(array_filter($emptyGroups, static fn($item) => $item['layout']['kind'] === 'argument-group'))[0];
checkXml(!$emptyGroup['supported'] && str_contains($emptyGroup['reason'], 'requires at least one argument'),
    'Schema-invalid empty argument groups remain explicitly unmeasured');
$typeFields = array_values(array_filter($arrayItems, static fn($item) => $item['layout']['kind'] === 'argument-type'));
checkXml(count($typeFields) === 38 && count(array_filter($typeFields, static fn($item) => !$item['supported'])) === 0,
    'Block/action argument and nested item type operands preserve independent supported source identities');
foreach ($typeFields as $field) {
    checkXml(str_ends_with($field['node'], '/@xsi:type'),
        'Type dispatch preserves each original field identity');
}
$modifierFields = array_values(array_filter($arrayItems, static fn($item) =>
    in_array($item['layout']['kind'], ['argument-translate', 'argument-shared', 'argument-model', 'argument-helper', 'argument-path'], true)));
checkXml(count($modifierFields) === 9 && count(array_filter($modifierFields, static fn($item) => !$item['supported'])) === 0,
    'Native argument modifier operands preserve separate supported source identities');
foreach ($modifierFields as $field) checkXml($field['layout']['kind'] === 'argument-' . $field['layout']['attribute'],
    'Distinct modifier attributes cannot overwrite one another in a source target');
$nameFields = array_values(array_filter($arrayItems, static fn($item) => $item['layout']['kind'] === 'argument-name'));
checkXml(count($nameFields) > count($leaves) && count(array_filter($nameFields, static fn($item) => !$item['supported'])) === 0,
    'Argument and item names preserve independent supported source identities');
foreach ($leaves as $leaf) {
    $name = array_values(array_filter($nameFields, static fn($item) => $item['path'] === $leaf['path'] . '/@name'));
    checkXml(count($name) === 1 && $name[0]['id'] !== $leaf['id'], 'Every attributable value leaf has a distinct original name operand');
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
$replacedLeaf = $bindLeaves->invoke($bindingCollector, ['value' => []], ['value' => 'same'], ['value' => $oldLeaf], ['value' => true], null);
checkXml(($replacedLeaf['value']['overridden'] ?? []) === ['old-leaf'] && !isset($replacedLeaf['value']['id']),
    'Equal-valued programmatic scalar updates retain the displaced XML origin without application credit');
$oldArray = ['pending' => ['id' => 'old-parent', 'input' => $fingerprint->invoke(null, ['changed' => 'same', 'surviving' => 'same'])],
    'children' => ['changed' => $oldLeaf, 'surviving' => ['id' => 'surviving-leaf', 'digest' => $oldLeaf['digest']]]];
$mixedArray = $bindLeaves->invoke($bindingCollector, ['value' => ['children' => ['changed' => []]]],
    ['value' => ['changed' => 'same', 'surviving' => 'same']], ['value' => $oldArray], ['value' => true], null);
checkXml(($mixedArray['value']['mixed'] ?? []) === ['old-parent']
    && ($mixedArray['value']['children']['changed']['overridden'] ?? []) === ['old-leaf']
    && ($mixedArray['value']['children']['surviving']['id'] ?? null) === 'surviving-leaf',
    'Mixed programmatic arrays retain the parent limitation, displaced leaf and independent surviving leaf');
foreach ([[], ['id' => 'new-scalar']] as $newOrigin) {
    $replacedArray = $bindLeaves->invoke($bindingCollector, ['value' => $newOrigin], ['value' => 'same'],
        ['value' => $oldArray], ['value' => true], null);
    checkXml(($replacedArray['value']['overridden'] ?? []) === ['old-parent', 'old-leaf', 'surviving-leaf']
        && !isset($replacedArray['value']['children']), 'Scalar replacement accounts for every displaced original array declaration');
}
echo "Programmatic argument overlays preserve displaced and surviving XML origins.\n";

require_once (require __DIR__ . '/project-root.php') . '/docker/php/xml-layout-references.php';
require_once (require __DIR__ . '/project-root.php') . '/docker/php/xml-layout-ownership.php';
$lazyCalls = 0;
$lazyType = new ReflectionClass(new class { public $value = 'same'; });
$lazyObject = $lazyType->newLazyGhost(static function ($object) use (&$lazyCalls): void {
    $lazyCalls++;
    $object->value = 'same';
});
checkXml(\MageLens\XmlCoverage\LayoutXmlOwnership::unhookedProperty($lazyObject, 'value') === null && $lazyCalls === 0,
    'Source ownership inspection must not initialize a lazy application object');
$lazyStorageCalls = 0;
$lazyStorageType = new ReflectionClass(new class { public array $elements = []; });
$lazyStorage = $lazyStorageType->newLazyGhost(static function ($object) use (&$lazyStorageCalls): void {
    $lazyStorageCalls++;
    $object->elements = ['native'];
});
$moveStorage = new ReflectionMethod(\MageLens\XmlCoverage\LayoutCoverage::class, 'moveStorage');
checkXml($moveStorage->invoke(null, $lazyStorage, $lazyStorageType->getName(), 'elements') === null && $lazyStorageCalls === 0,
    'Move provenance must not initialize lazy backing storage while checking readiness');
$plainStorage = $lazyStorageType->newInstance();
checkXml($moveStorage->invoke(null, $plainStorage, $lazyStorageType->getName(), 'elements') === [],
    'Ordinary native backing arrays retain move provenance inspection');
foreach (['references' => 8193, 'effect origins' => 32769] as $limit => $count) {
    $targets = [];
    for ($index = 0; $index < $count; $index++) {
        $targets[] = $limit === 'references'
            ? ['reference' => ['id' => (string) $index]]
            : ['referenceOwner' => 'parent', 'ids' => ['argument' => (string) $index]];
    }
    try {
        new \MageLens\XmlCoverage\LayoutReferenceCoverage([['targets' => $targets]], static fn() => []);
        throw new LogicException('Oversized reference inventory was accepted');
    } catch (RuntimeException $error) {
        checkXml(str_contains($error->getMessage(), 'Layout reference inventory exceeded'),
            'Reference declaration and effect-origin bounds reject oversized inventories');
    }
}
echo "Reference inventory bounds reject incomplete attribution.\n";

require_once (require __DIR__ . '/project-root.php') . '/docker/php/xml-layout-argument-names.php';
$targets = [];
for ($index = 0; $index < 32769; $index++) $targets[] = ['ids' => ['argument' => 'value-' . $index, 'argument-name' => 'name-' . $index]];
try {
    new \MageLens\XmlCoverage\LayoutArgumentNames([['targets' => $targets]]);
    throw new LogicException('Oversized argument name inventory was accepted');
} catch (RuntimeException $error) {
    checkXml(str_contains($error->getMessage(), '32768 operands'), 'Argument name attribution remains bounded');
}
$names = new \MageLens\XmlCoverage\LayoutArgumentNames([['targets' => [$targets[0]]]]);
checkXml($names->related('value-0', 'layout-argument-applied') === ['name-0', 'layout-argument-name-applied']
    && $names->related('value-0', 'layout-argument-read') === null
    && $names->related('value-0', 'layout-argument-evaluated') === null,
    'A native key assignment never infers fresh name evaluation or later key consumption');
echo "Argument name assignments retain a bounded independent evidence boundary.\n";

foreach (['', '0'] as $emptyTemplate) {
    $declarations = LayoutManifest::declarations('app/code/Fixture/view/frontend/layout/empty.xml',
        '<layout><block name="fixture" template="' . $emptyTemplate . '"/></layout>');
    $template = array_values(array_filter($declarations, static fn($item) => $item['layout']['attribute'] === 'template'))[0];
    checkXml($template['supported'] && $template['layout']['kind'] === 'template',
        'Empty and zero template attributes retain original template identities');
}
echo "Native empty template operands retain original inventory identities.\n";

$guardDeclarations = LayoutManifest::declarations('app/code/Fixture/view/frontend/layout/guards.xml',
    '<layout><block name="fixture"><action method="mark" ifconfig="fixture/guard"/></block></layout>');
$guard = array_values(array_filter($guardDeclarations, static fn($item) => $item['layout']['attribute'] === 'ifconfig'))[0];
checkXml($guard['supported'] && $guard['layout']['kind'] === 'action-ifconfig',
    'Action scope guards have an independent original operand identity');
echo "Action guards retain independent original inventory identities.\n";

require_once (require __DIR__ . '/project-root.php') . '/docker/php/xml-layout-positions.php';
$positionTargets = [];
for ($index = 0; $index <= 32768; $index++) {
    $positionTargets[] = ['element' => '0', 'ids' => ['position-name' => 'defaulted-name-' . $index]];
}
try {
    new \MageLens\XmlCoverage\LayoutPositionCoverage(static fn() => [], [['targets' => $positionTargets]]);
    throw new RuntimeException('Oversized defaulted name inventory was accepted');
} catch (RuntimeException $error) {
    checkXml(str_contains($error->getMessage(), 'defaulted name inventory exceeded 32768'), 'Defaulted name inventory is bounded');
}
echo "Defaulted native element name inventory is bounded.\n";

$magicMethods = LayoutManifest::declarations('app/code/Acme/Blog/view/frontend/layout/magic.xml',
    '<layout><block name="fixture"><action method="" ifconfig="fixture/guard"/><action method="0"/><action/></block></layout>');
foreach (['action' => 2, 'action-method' => 2, 'action-ifconfig' => 1] as $kind => $expected) {
    $matches = array_filter($magicMethods, static fn($item) => $item['layout']['kind'] === $kind && $item['supported']);
    checkXml(count($matches) === $expected, 'Native empty/zero magic action methods retain independent original operands');
}
echo "Empty and zero native magic action methods retain source identities.\n";
checkXml(count(array_filter($magicMethods, static fn($item) => $item['layout']['instruction'] === 'action'
    && $item['layout']['kind'] === 'instruction' && !$item['supported'])) === 1,
    'An absent required method remains outside the supported action grammar');

$module = 'app/code/Fixture/Module';
$lexical = <<<'XML'
<page xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <body>
        <referenceBlock
            name = "first"
            template="Fixture_Module::a
            b.phtml">
            <arguments>
                <argument name="value" xsi:type="string">first</argument>
            </arguments>
            <block name="own" template="Fixture_Module::own.phtml"/>
            <referenceContainer name="nested">
                <block name="child" template="Fixture_Module::child.phtml"/>
                <referenceBlock name="inner" template="Fixture_Module::inner.phtml"/>
            </referenceContainer>
        </referenceBlock>
        <referenceBlock name="empty"/>
    </body>
</page>
XML;
$lexicalPath = "$module/view/frontend/layout/ranges.xml";
$items = LayoutManifest::declarations($lexicalPath, $lexical);
$byPath = array_column($items, null, 'path');
$refPath = '/page/body/referenceBlock[1]';
$template = $byPath["$refPath/@template"];
checkXml($template['startLine'] === 5 && $template['endLine'] === 6, 'Multiline attribute must retain its own lexical range');
checkXml($byPath["$refPath/@name"]['startLine'] === 4 && $byPath["$refPath/@name"]['endLine'] === 4,
    'Attribute followed by a multiline value must retain its own line');
$targets = LayoutManifest::targets([['path' => $lexicalPath, 'sourceHash' => hash('sha256', $lexical), 'family' => 'layout',
    'declarations' => $items]])[$lexicalPath]['targets'];
$target = static fn(string $path) => $targets[$byPath[$path]['layout']['ordinal']];
checkXml($target("$refPath/arguments/argument")['referenceOwner'] === $byPath[$refPath]['id'], 'Argument lost its outer reference');
checkXml(!isset($target("$refPath/block")['referenceOwner']) && !isset($target("$refPath/referenceContainer/block")['referenceOwner']),
    'Nested block leaked coverage to a reference');
$innerPath = "$refPath/referenceContainer/referenceBlock";
checkXml($target($innerPath)['referenceOwner'] === $byPath[$innerPath]['id'], 'Nested reference attribute lost its own target');
checkXml(!$target($refPath)['reference']['empty'] && !$target("$refPath/referenceContainer")['reference']['empty']
    && $target('/page/body/referenceBlock[2]')['reference']['empty'], 'Reference emptiness changed');

$theme = 'app/design/frontend/Fixture/theme/Fixture_Module';
$vendor = 'vendor/acme/module';
foreach ([
    ["$module/view/frontend/layout/layouts.xml", '<page><body/></page>', 'page', 'file-selection'],
    ["$module/view/adminhtml/layout/page_types.xml", '<layout><container name="target"/></layout>', 'generic', 'file-selection'],
    ["$module/view/base/layouts.xml", '<page_layouts><layout id="test"/></page_layouts>', 'registry', 'registry-entry'],
    ["$module/etc/frontend/page_types.xml", '<page_types><type id="test" label="Test"/></page_types>', 'page-types', 'page-type'],
    ["$theme/layouts.xml", '<page_layouts><layout id="test"/></page_layouts>', 'registry', 'registry-entry'],
    ["$theme/layout/override/base/layouts.xml", '<page><body/></page>', 'page', 'file-override'],
    ["$theme/layout/override/theme/Parent/default/page_types.xml", '<page/>', 'page', 'file-override'],
    ["$vendor/view/frontend/page_layout/layouts.xml", '<layout/>', 'wireframe', 'wireframe'],
    ['vendor/acme/theme/Fixture_Module/layout/page_types.xml', '<page/>', 'page', 'file-selection'],
    ["$module/view/frontend/layout/layouts.xml", '<page_layouts><layout id="test"/></page_layouts>', 'custom', 'instruction'],
    ["$module/etc/frontend/page_types.xml", '<page/>', 'custom', 'instruction'],
] as [$path, $source, $type, $kind]) {
    checkXml(LayoutManifest::isLayout($path), "Native provider path missing for $path");
    $items = LayoutManifest::declarations($path, $source);
    checkXml(array_unique(array_column(array_column($items, 'layout'), 'fileType')) === [$type]
        && in_array($kind, array_column(array_column($items, 'layout'), 'kind'), true), "Misclassified native layout $path ($type)");
}
foreach ([
    "$module/view/frontend/web/layout/layouts.xml",
    "$theme/web/layout/page_types.xml",
    "$vendor/view/frontend/web/layout/static.xml",
    "$module/etc/subdirectory/layouts.xml",
    "$module/view/frontend/layout/override/base/test.xml",
] as $path) checkXml(!LayoutManifest::isLayout($path), "Static or non-provider XML accepted: $path");
