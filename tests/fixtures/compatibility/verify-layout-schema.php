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
        if ($file->getExtension() === 'xml') $files[] = $file->getPathname();
    }
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
$namespace = 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
$pageSchema = 'urn:magento:framework:View/Layout/etc/page_configuration.xsd';
$genericSchema = 'urn:magento:framework:View/Layout/etc/layout_generic.xsd';
foreach ([
    ['asoc argument', $pageSchema, "<page $namespace><body><block name=\"fixture\"><arguments><argument name=\"value\" xsi:type=\"asoc\"/></arguments></block></body></page>"],
    ['page standalone removal', $pageSchema, '<page><body><remove name="fixture"/></body></page>'],
    ['generic standalone removal', $genericSchema, '<layout><remove name="fixture"/></layout>'],
    ['metadata property attribute', $pageSchema, '<page><head><meta property="og:title" content="fixture"/></head></page>'],
    ['block custom visibility', $pageSchema, '<page><body><block name="fixture"><visibilityCondition name="fixture" className="Fixture"/></block></body></page>'],
] as [$name, $schema, $source]) {
    if (!$validate($source, $schema)) throw new RuntimeException('Native schema accepted ' . $name);
}
printf("Verified %d native layout/UI schemas and five rejected grammar cases.\n", count($files));
