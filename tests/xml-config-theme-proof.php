<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

require '/var/www/html/app/bootstrap.php';
require dirname(getenv('MAGELENS_XML_HOOKS') ?: (require __DIR__ . '/project-root.php') . '/docker/php/xml-hooks.php') . '/xml-manifest.php';
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

$files = [['declarations' => [['family' => 'config', 'supported' => true, 'path' => 'magelens_test/display/title']]]];
$resource = $objects->get(\Magento\Framework\App\ResourceConnection::class);
$db = $resource->getConnection();
$table = $resource->getTableName('core_config_data');
$db->beginTransaction();
try {
    $original = xmlFingerprint($objects, $files);
    $write = static function (string $path) use ($db, $table): void {
        $db->insertOnDuplicate($table, ['scope' => 'default', 'scope_id' => 0, 'path' => $path, 'value' => 'probe']);
    };
    $write('magelens_test/display/runtime_state');
    $write('admin/system_admin_design/runtime_state');
    if (xmlFingerprint($objects, $files) !== $original) throw new RuntimeException('Unrelated database configuration changed XML provenance');
    foreach (['magelens_test/display/title/nested', 'magelens_test/display', 'magelens_test/display/title', 'design/theme/ua_regexp',
        'admin/system_admin_design/active_theme'] as $path) {
        $write($path);
        if (xmlFingerprint($objects, $files) === $original) throw new RuntimeException("Relevant database configuration escaped fingerprinting at $path");
        // The writes are transactional, including restoring any existing row.
        $db->rollBack();
        $db->beginTransaction();
    }
    echo "Verified the database fingerprint tracks XML configuration and theme selection without unrelated runtime state.\n";
} finally {
    $db->rollBack();
}
