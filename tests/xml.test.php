<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
require __DIR__ . '/../docker/php/xml-manifest.php';
use MageLens\XmlCoverage\Xml;
function checkXml(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
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
echo "XML parsing, source maps, scopes and field identities passed.\n";

require __DIR__ . '/configuration-fixture.test.php';
