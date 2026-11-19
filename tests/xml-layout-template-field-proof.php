<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
require '/var/www/html/app/bootstrap.php';
$hooks = dirname(getenv('MAGELENS_XML_HOOKS') ?: __DIR__ . '/../docker/php/xml-hooks.php');
require $hooks . '/xml-layout-field-access.php';

use MageLens\XmlCoverage\LayoutFieldAccess;
use Magento\Framework\View\Element\Template;

$mode = $argv[1] ?? 'literal';
$bodies = [
    'clean' => 'public function fixture() { return $this->getTemplate(); }',
    'literal' => 'public function fixture() { $this->_template = "same"; }',
    'record-limit' => 'public function fixture() { $this->_template = "same"; }',
    'variable' => 'public function fixture() { $field = "_template"; $this->$field = "same"; }',
    'braced' => 'public function fixture() { $this->{"_template"} = "same"; }',
    'foreign' => 'public function fixture($block) { $block->_template = "same"; }',
    'public' => 'public $_template;',
    'reflection' => 'public function fixture() { (new \\ReflectionProperty(\\Magento\\Framework\\View\\Element\\Template::class, "_template"))->setRawValue($this, "same"); }',
    'hook' => 'public string $fixture { get { $this->_template = "same"; return "same"; } }',
];
$directory = sys_get_temp_dir() . '/magelens-template-field-' . bin2hex(random_bytes(8));
if (!mkdir($directory, 0700)) throw new RuntimeException('Cannot create disposable implementation fixture');
$file = $directory . '/implementation.php';
$class = 'MageLensTemplateFieldFixture';
$field = in_array('--data', $argv, true) ? '_data' : '_template';
$source = '<?php class ' . $class . ' extends \\' . Template::class . ' {' . ($bodies[$mode] ?? $bodies['clean']) . '}';
try {
    if ($mode === 'access-limit') $source = '<?php class ' . $class . ' extends \\' . Template::class
        . ' { public function fixture() {' . str_repeat('$this->_template = "same";', 4097) . '} }';
    $source = str_replace('_template', $field, $source);
    if ($mode === 'opaque') eval('class ' . $class . ' extends \\' . Template::class . ' { public function fixture() {} }');
    else {
        file_put_contents($file, $source);
        require $file;
    }
    $guard = new LayoutFieldAccess($field, $field === '_data' ? Magento\Framework\View\Element\AbstractBlock::class : Template::class, $field === '_data' ? 'Block data' : 'Template');
    if ($mode === 'record-limit') (new ReflectionProperty($guard, 'accessCount'))->setValue($guard, 32768);
    if (in_array($mode, ['class-limit', 'file-limit'], true)) {
        $property = new ReflectionProperty($guard, $mode === 'class-limit' ? 'classes' : 'files');
        $property->setValue($guard, array_fill_keys(array_map(static fn($index) => 'fixture.' . $index, range(1, 1024)), false));
    }
    $expectedError = match ($mode) {
        'class-limit' => '1024 classes', 'file-limit' => '1024 files', 'access-limit' => '4096 field accesses',
        'record-limit' => '32768 field accesses',
        'edit', 'symlink', 'missing' => 'source changed', default => null,
    };
    try {
        $block = (new ReflectionClass($class))->newInstanceWithoutConstructor();
        $unconfirmed = $guard->unconfirmed($block);
        $expected = isset($bodies[$mode]) && $mode !== 'clean' || $mode === 'opaque';
        if ($unconfirmed !== $expected) throw new LogicException('Template implementation capability decision differs for ' . $mode);
        if ($mode === 'edit') file_put_contents($file, $source . "\n// changed\n");
        if ($mode === 'missing') unlink($file);
        if ($mode === 'symlink') {
            rename($file, $directory . '/replacement.php');
            symlink($directory . '/replacement.php', $file);
        }
        clearstatcache();
        $guard->finish();
        if ($expectedError !== null) throw new LogicException('Expected publication rejection for ' . $mode);
    } catch (RuntimeException $error) {
        if ($expectedError === null || !str_contains($error->getMessage(), $expectedError)) throw $error;
    }
    echo 'Verified passive ', $field, ' capability/integrity control: ', $mode, ".\n";
} finally {
    foreach (glob($directory . '/*') as $entry) unlink($entry);
    rmdir($directory);
}
