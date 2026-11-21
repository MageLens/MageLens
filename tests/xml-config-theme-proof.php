<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

require '/var/www/html/app/bootstrap.php';
require dirname(getenv('MAGELENS_XML_HOOKS') ?: __DIR__ . '/../docker/php/xml-hooks.php') . '/xml-data.php';
use MageLens\XmlCoverage\Xml;

$objects = \Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$reader = clone $objects->get(\Magento\Framework\App\Config\Initial\Reader::class);
$resolver = new class implements \Magento\Framework\Config\FileResolverInterface {
    public array $sources = [];
    public function get($filename, $scope = null) { return $this->sources; }
};
(new ReflectionProperty($reader, '_fileResolver'))->setValue($reader, $resolver);
$resolver->sources = ['fixture.xml' => '<config><default><design><theme><theme_id>frontend/Magento/blank</theme_id></theme></design></default>'
    . '<stores><reading><design><theme><theme_id>frontend/Magento/blank</theme_id></theme></design></reading></stores></config>'];
$processor = $objects->get(\Magento\Theme\Model\Config\Processor\DesignTheme::class);
set_error_handler(static function ($severity, $message): never { throw new RuntimeException($message); });
try {
    $native = $processor->process($reader->read()['data']);
    $default = $native['default']['design']['theme']['theme_id'];
    if (!is_numeric($default) || $native['stores']['reading']['design']['theme']['theme_id'] !== $default) {
        throw new RuntimeException('Native theme path conversion differs across configuration scopes');
    }
    echo "Verified native scoped theme paths resolve to the installed theme identity.\n";
    if (in_array('--native-only', $argv, true)) exit;
    $symbolic = Xml::symbolicSources($resolver->sources, []);
    $resolver->sources = $symbolic['sources'];
    $replayed = $processor->process($reader->read()['data']);
    if ($replayed !== $native || count($symbolic['unmeasured']) !== 2) {
        throw new RuntimeException('Symbolic replay changed the native theme transformation or retained an unsupported origin');
    }
    $masked = Xml::maskConfiguration($native);
    if ($processor->process($masked) !== $native) throw new RuntimeException('Masked external provider changed native theme processing');
    echo "Verified original theme preprocessing and explicit unmeasured provenance through XML and external providers.\n";
} finally {
    restore_error_handler();
}
