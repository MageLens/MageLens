<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace Magento\Framework\App {
    class Config {
        public function getValue($path = null, $scope = 'default', $code = null) {
            if ($path === 'throws') throw new \LogicException('original exception');
            return $path === 'journal/disabled' ? '0' : 'original value';
        }
        public function isSetFlag($path, $scope = 'default', $code = null) { return !!$this->getValue($path, $scope, $code); }
    }
}
namespace Magento\Config\Block\System\Config\Form {
    class Field { public function render($element) { return '<input>'; } }
}
namespace {
    require __DIR__ . '/../docker/php/xml-hooks.php';
    use MageLens\XmlCoverage\Recorder;
    function verifyHook(bool $condition, string $message): void { if (!$condition) throw new \RuntimeException($message); }
    @mkdir('/coverage');
    $manifest = ['run' => 'test', 'id' => 'manifest', 'paths' => ['journal/title' => true, 'journal/disabled' => true],
        'originScopes' => ['default' => ['journal/title' => 'title', 'journal/disabled' => 'disabled'], 'stores/reading' => ['journal/title' => 'store-title']],
        'valueHashes' => ['default' => ['journal/title' => hash('sha256', json_encode('original value')), 'journal/disabled' => hash('sha256', json_encode('0'))],
            'stores/reading' => ['journal/title' => hash('sha256', json_encode('original value'))]],
        'scopes' => ['stores' => ['1' => 'reading']], 'fields' => ['journal/display/title' => ['field']], 'fieldHashes' => ['journal/display/title' => hash('sha256', \MageLens\XmlCoverage\Xml::canonical(['path' => 'journal/display', 'id' => 'title']))]];
    file_put_contents('/coverage/xml-collector.json', json_encode($manifest, JSON_THROW_ON_ERROR));
    $original = hash_file('sha256', __FILE__);
    $config = new \Magento\Framework\App\Config;
    startXmlHooks('test');
    verifyHook($config->getValue('journal/title') === 'original value', 'Observer cannot change return values');
    verifyHook($config->isSetFlag('journal/disabled') === false, 'Observer preserves false values');
    $config->getValue('journal/title', 'store', 1);
    $config->getValue('unrelated');
    try { $config->getValue('throws'); throw new \RuntimeException('Exception suppressed'); }
    catch (\LogicException $exception) { verifyHook($exception->getMessage() === 'original exception', 'Original exception preserved'); }
    $element = new class {
        public function getFieldConfig() { return ['path' => 'journal/display', 'id' => 'title']; }
        public function getScope() { return 'stores'; }
        public function getScopeId() { return 1; }
    };
    $renderer = new \Magento\Config\Block\System\Config\Form\Field;
    verifyHook($renderer->render($element) === '<input>', 'Renderer result stays unchanged');
    $record = Recorder::finish();
    verifyHook($record['readHook'] === true, 'Real native callback heartbeat');
    verifyHook(count($record['events']) === 4, 'Only selected paths produce evidence');
    verifyHook($record['events'][2]['requestedScope'] === ['type' => 'stores', 'code' => 'reading'], 'Numeric and singular scope resolved');
    verifyHook($original === hash_file('sha256', __FILE__), 'Hooking cannot rewrite original source');
    verifyHook($record['renderHook'] === true && $record['events'][3]['type'] === 'system-field-render', 'Real native rendering hook');
    Recorder::mutation();
    try { Recorder::finish(); throw new \LogicException('Mutation accepted'); }
    catch (\RuntimeException $exception) { verifyHook(str_contains($exception->getMessage(), 'changed'), 'Mutation fails measurement'); }
    echo "Native OpenTelemetry callbacks with PCOV loaded preserve source, results, flags and exceptions.\n";
}
