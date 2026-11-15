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
namespace Magento\Config\Model\Config\Structure {
    abstract class AbstractElement {
        public function __construct(private array $data) {}
        public function getData() { return $this->data; }
    }
}
namespace Magento\Config\Model\Config\Structure\Element {
    class Field extends \Magento\Config\Model\Config\Structure\AbstractElement {}
    // Mirror an interceptor's afterGetData plugin: native getData returns the
    // source array first, then the plugin decorates the caller's copy.
    class DecoratedField extends Field {
        public function getData() { return parent::getData() + ['path_hint' => '<small>Path: journal/title</small>']; }
    }
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
    $source = new \Magento\Config\Model\Config\Structure\Element\Field(['path' => 'journal/display', 'id' => 'title']);
    $source->getData();
    verifyHook(count(Recorder::finish()['events']) === 3, 'Metadata reads alone do not grant rendering coverage');
    verifyHook($renderer->render($element) === '<input>', 'Renderer result stays unchanged');
    $decorated = new \Magento\Config\Model\Config\Structure\Element\DecoratedField(['path' => 'journal/display', 'id' => 'title']);
    $decoratedElement = new class($decorated->getData()) {
        public function __construct(private array $data) {}
        public function getFieldConfig() { return $this->data; }
        public function getScope() { return 'stores'; }
        public function getScopeId() { return 1; }
    };
    verifyHook(isset($decoratedElement->getFieldConfig()['path_hint']), 'Presentation metadata reaches the renderer unchanged');
    verifyHook($renderer->render($decoratedElement) === '<input>', 'Decorated field result stays unchanged');
    $record = Recorder::finish();
    verifyHook($record['readHook'] === true, 'Real native callback heartbeat');
    verifyHook(count($record['events']) === 4, 'Only selected paths produce evidence');
    verifyHook($record['events'][2]['requestedScope'] === ['type' => 'stores', 'code' => 'reading'], 'Numeric and singular scope resolved');
    verifyHook($original === hash_file('sha256', __FILE__), 'Hooking cannot rewrite original source');
    verifyHook($record['renderHook'] === true && $record['events'][3]['type'] === 'system-field-render', 'Real native rendering hook');
    verifyHook($record['events'][3]['hits'] === 2, 'Source metadata validates both plain and plugin-decorated rendering');
    // A decorator cannot hide stale cached source data behind a current-looking
    // form element. The original metadata remains the strict comparison target.
    $stale = new \Magento\Config\Model\Config\Structure\Element\DecoratedField(['path' => 'journal/display', 'id' => 'title', 'label' => 'stale']);
    $stale->getData();
    $renderer->render($element);
    try { Recorder::finish(); throw new \LogicException('Stale source accepted'); }
    catch (\RuntimeException $exception) { verifyHook(str_contains($exception->getMessage(), 'Cached Admin structure differs'), 'Stale source still fails measurement'); }
    (new \ReflectionProperty(Recorder::class, 'errors'))->setValue(null, []);
    (new \ReflectionProperty(Recorder::class, 'fieldSources'))->setValue(null, []);
    $renderer->render($element);
    try { Recorder::finish(); throw new \LogicException('Unobserved metadata accepted'); }
    catch (\RuntimeException $exception) { verifyHook(str_contains($exception->getMessage(), 'not observed'), 'Rendering requires source metadata evidence'); }
    (new \ReflectionProperty(Recorder::class, 'errors'))->setValue(null, []);
    Recorder::mutation();
    try { Recorder::finish(); throw new \LogicException('Mutation accepted'); }
    catch (\RuntimeException $exception) { verifyHook(str_contains($exception->getMessage(), 'changed'), 'Mutation fails measurement'); }
    echo "Native OpenTelemetry callbacks with PCOV loaded preserve source, results, flags and exceptions; decorated Admin fields retain strict source validation.\n";
}
