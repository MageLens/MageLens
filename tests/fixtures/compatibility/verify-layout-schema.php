<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

require '/var/www/html/app/bootstrap.php';
\Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();

$validate = static function (string $source, string $schema): array {
    $document = new DOMDocument();
    if (!$document->loadXML($source, LIBXML_NONET)) throw new RuntimeException('Malformed layout fixture');
    return \Magento\Framework\Config\Dom::validateDomDocument($document, $schema);
};
$files = [];
foreach (['app/code/MageLens/Compatibility/view', 'app/code/MageLens/LayoutOverlay/view',
    'app/design/frontend/MageLens/parent', 'app/design/frontend/MageLens/child',
    'app/design/frontend/MageLens/inactive'] as $directory) {
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator(BP . '/' . $directory, FilesystemIterator::SKIP_DOTS)) as $file) {
        if (in_array($file->getExtension(), ['xml', 'xhtml'], true)) $files[] = $file->getPathname();
    }
}
foreach (['Compatibility', 'LayoutOverlay'] as $module) {
    $files[] = BP . '/app/code/MageLens/' . $module . '/etc/frontend/page_types.xml';
}
sort($files);
foreach ($files as $file) {
    $source = file_get_contents($file);
    $document = new DOMDocument();
    $document->loadXML($source, LIBXML_NONET);
    $schema = $document->documentElement->getAttributeNS(
        'http://www.w3.org/2001/XMLSchema-instance', 'noNamespaceSchemaLocation'
    );
    $errors = $validate($source, $schema);
    if ($errors) throw new RuntimeException(basename($file) . "\n" . implode("\n", $errors));
}
$mergeType = \Magento\Framework\View\Model\Layout\Merge::class;
$merge = (new ReflectionClass($mergeType))->newInstanceWithoutConstructor();
$renderAttributes = new ReflectionMethod($mergeType, '_renderXmlAttributes');
foreach (['xsi', 'grammar'] as $prefix) {
    $hinted = '<layout xmlns:' . $prefix . '="http://www.w3.org/2001/XMLSchema-instance" '
        . $prefix . ':noNamespaceSchemaLocation="urn:magelens:unused-schema-hint"/>';
    if ($validate($hinted, 'urn:magento:framework:View/Layout/etc/layout_generic.xsd')) {
        throw new RuntimeException('The configured native schema unexpectedly used the source hint');
    }
    $xml = simplexml_load_string($hinted, \Magento\Framework\View\Layout\Element::class);
    if ((string) $xml->attributes('http://www.w3.org/2001/XMLSchema-instance')->noNamespaceSchemaLocation === ''
        || $renderAttributes->invoke($merge, $xml) !== '') {
        throw new RuntimeException('Native packaging retained the namespaced schema hint');
    }
}
echo "Verified configured native validation and omitted source schema hints with two namespace prefixes.\n";
foreach (['xsi', 'typed'] as $prefix) {
    $source = '<argument xmlns:' . $prefix . '="http://www.w3.org/2001/XMLSchema-instance" '
        . 'name="value" ' . $prefix . ':type="string">fixture</argument>';
    $element = new \Magento\Framework\View\Layout\Element($source);
    if ((string) $element->attributes('http://www.w3.org/2001/XMLSchema-instance')->type !== 'string') {
        throw new RuntimeException('Expected a namespace-equivalent source type attribute');
    }
    $serialized = new DOMDocument();
    $serialized->loadXML('<root xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' . $element->asNiceXml() . '</root>');
    $type = $serialized->documentElement->firstElementChild->getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'type');
    if ($type !== ($prefix === 'xsi' ? 'string' : '')) throw new RuntimeException('Native type serialization prefix behavior changed');
}
echo "Verified the native layout serializer retains only the literal xsi type prefix.\n";
$namespace = 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
$pageSchema = 'urn:magento:framework:View/Layout/etc/page_configuration.xsd';
$genericSchema = 'urn:magento:framework:View/Layout/etc/layout_generic.xsd';
$rejected = [
    ['spaced block TTL', $genericSchema, '<layout><block name="fixture" ttl=" 0 "/></layout>'],
    ['zero container ID', $genericSchema, '<layout><container name="fixture" htmlId="0"/></layout>'],
    ['block display attribute', $genericSchema, '<layout><block name="fixture" display="0"/></layout>'],
    ['empty reference display', $genericSchema, '<layout><referenceBlock name="fixture" display=""/></layout>'],
    ['empty block TTL', $genericSchema, '<layout><block name="fixture" ttl=""/></layout>'],
    ['layout item sort order', $pageSchema, "<page $namespace><body><block name=\"fixture\"><arguments><argument name=\"value\" xsi:type=\"array\"><item name=\"child\" xsi:type=\"string\" sortOrder=\"1\">fixture</item></argument></arguments></block></body></page>"],
    ['layout init parameter', $pageSchema, "<page $namespace><body><block name=\"fixture\"><arguments><argument name=\"value\" xsi:type=\"init_parameter\">fixture</argument></arguments></block></body></page>"],
    ['zero move alias', $genericSchema, '<layout><move element="source" destination="target" as="0"/></layout>'],
    ['empty move alias', $genericSchema, '<layout><move element="source" destination="target" as=""/></layout>'],
    ['empty move sibling', $genericSchema, '<layout><move element="source" destination="target" after=""/></layout>'],
    ['numeric move sibling', $genericSchema, '<layout><move element="source" destination="target" before="1"/></layout>'],
    ['empty block class', $pageSchema, '<page><body><block class="" name="fixture"/></body></page>'],
    ['container display attribute', $genericSchema, '<layout><container name="fixture" display="false"/></layout>'],
    ['merged root UI placement', 'urn:magento:framework:View/Layout/etc/layout_merged.xsd', '<layout><handle id="fixture"><uiComponent name="fixture"/></handle></layout>'],
    ['disabled registry translation', 'urn:magento:framework:View/PageLayout/etc/layouts.xsd', '<page_layouts><layout id="fixture"><label translate="false">Fixture</label></layout></page_layouts>'],
    ['disabled output membership', $genericSchema, '<layout><container name="fixture" output="0"/></layout>'],
    ['asoc argument', $pageSchema, "<page $namespace><body><block name=\"fixture\"><arguments><argument name=\"value\" xsi:type=\"asoc\"/></arguments></block></body></page>"],
    ['page standalone removal', $pageSchema, '<page><body><remove name="fixture"/></body></page>'],
    ['generic standalone removal', $genericSchema, '<layout><remove name="fixture"/></layout>'],
    ['metadata property attribute', $pageSchema, '<page><head><meta property="og:title" content="fixture"/></head></page>'],
    ['block custom visibility', $pageSchema, '<page><body><block name="fixture"><visibilityCondition name="fixture" className="Fixture"/></block></body></page>'],
    ['text-only configurable object', $pageSchema, "<page $namespace><body><block name=\"fixture\"><arguments><argument name=\"value\" xsi:type=\"configurableObject\">Fixture</argument></arguments></block></body></page>"],
];
foreach ($rejected as [$name, $schema, $source]) {
    if (!$validate($source, $schema)) throw new RuntimeException('Native schema accepted ' . $name);
}
printf("Verified %d native layout/UI schemas and %d rejected grammar cases.\n", count($files), count($rejected));
