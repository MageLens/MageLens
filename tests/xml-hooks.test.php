<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace Magento\Framework\App {
    class Config {
        public function __construct(private $system = new \Magento\Config\App\Config\Type\System) {}
        public function get($type, $path) { return $this->system->get($path); }
        public function getValue($path = null, $scope = 'default', $code = null) {
            $scope = ['store' => 'stores', 'website' => 'websites'][$scope] ?? $scope;
            if (is_object($code)) $code = $code->getCode();
            if (is_numeric($code)) $code = [1 => 'reading', 2 => 'UK_English'][$code];
            return $this->get('system', $scope . ($scope === 'default' ? '' : '/' . $code) . '/' . $path);
        }
        public function isSetFlag($path, $scope = 'default', $code = null) { return !!$this->getValue($path, $scope, $code); }
    }
}
namespace Magento\Framework\App\Config {
    class Interceptor extends \Magento\Framework\App\Config {
        public function getValue($path = null, $scope = 'default', $code = null) { parent::getValue($path, $scope, $code); return '0'; }
    }
}
namespace Magento\Config\App\Config\Type {
    class System {
        public function get($path = '') {
            if ($path === 'default/throws') throw new \LogicException('original exception');
            if ($path !== '') $this->get(''); // Internal cache/audit snapshot, not a consumer read.
            if ($path === 'default/journal/stale') return '0';
            if ($path === '') return ['default' => ['journal' => ['title' => '1', 'disabled' => '0']]];
            if ($path === 'default/') return ['journal' => ['title' => '1', 'disabled' => '0']];
            if ($path === 'default/journal') return ['title' => '1', 'disabled' => '0'];
            return str_ends_with($path, '/disabled') ? '0' : '1';
        }
    }
}
namespace Magento\Config\App\Config\Type\System {
    class Interceptor extends \Magento\Config\App\Config\Type\System {
        public function get($path = '') { parent::get($path); return '0'; }
    }
    class Replacement extends \Magento\Config\App\Config\Type\System {
        public function get($path = '') { return '0'; }
    }
}
namespace Magento\Backend\App {
    class Config {
        public function __construct(private \Magento\Framework\App\Config $appConfig) {}
        public function getValue($path) { return $this->appConfig->get('system', 'default/' . $path); }
        public function isSetFlag($path) { return !!$this->appConfig->get('system', 'default/' . $path); }
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
        'valueHashes' => ['default' => ['journal/title' => hash('sha256', json_encode('1')), 'journal/disabled' => hash('sha256', json_encode('0'))],
            'stores/reading' => ['journal/title' => hash('sha256', json_encode('1'))]],
        'scopes' => ['stores' => ['1' => 'reading']], 'fields' => ['journal/display/title' => ['field']], 'fieldHashes' => ['journal/display/title' => hash('sha256', \MageLens\XmlCoverage\Xml::canonical(['path' => 'journal/display', 'id' => 'title']))]];
    foreach (['backend-value', 'backend-flag', 'replacement', 'stale'] as $leaf) {
        $manifest['paths']['journal/' . $leaf] = true;
        $manifest['originScopes']['default']['journal/' . $leaf] = $leaf;
        $manifest['valueHashes']['default']['journal/' . $leaf] = hash('sha256', json_encode('1'));
    }
    $manifest['paths']['journal'] = true;
    $manifest['paths'][''] = true;
    foreach (['UK_English', 'uk_english'] as $code) {
        $manifest['originScopes']['stores/' . $code] = ['journal/title' => 'mixed-title'];
        $manifest['valueHashes']['stores/' . $code] = ['journal/title' => hash('sha256', json_encode('1'))];
        $manifest['scopeCodes']['stores'][$code] = true;
    }
    $manifest['scopes']['stores'][2] = 'UK_English';
    file_put_contents('/coverage/xml-collector.json', json_encode($manifest, JSON_THROW_ON_ERROR));
    $original = hash_file('sha256', __FILE__);
    $config = new \Magento\Framework\App\Config;
    startXmlHooks('test');
    $backend = new \Magento\Backend\App\Config($config);
    verifyHook($backend->getValue('journal/backend-value') === '1', 'Backend values use the shared system getter');
    verifyHook($backend->isSetFlag('journal/backend-flag') === true, 'Backend flags use the shared system getter');
    $backendOnly = Recorder::finish();
    verifyHook($backendOnly['readHook'] && count($backendOnly['events']) === 2, 'Backend reads establish the heartbeat without any Framework getValue call');
    verifyHook($config->getValue('journal/title') === '1', 'Observer cannot change return values');
    verifyHook($config->isSetFlag('journal/disabled') === false, 'Observer preserves false values');
    $config->getValue('journal/title', 'store', 1);
    $config->getValue('unrelated');
    try { $config->getValue('throws'); throw new \RuntimeException('Exception suppressed'); }
    catch (\LogicException $exception) { verifyHook($exception->getMessage() === 'original exception', 'Original exception preserved'); }
    $decoratedConfig = new \Magento\Framework\App\Config\Interceptor(new \Magento\Config\App\Config\Type\System\Interceptor);
    verifyHook($decoratedConfig->getValue('journal/title') === '0', 'Both getter decorations reach the application unchanged');
    verifyHook($decoratedConfig->isSetFlag('journal/title') === false, 'Flags retain decorated application semantics');
    foreach (['UK_English', 'uk_english'] as $code) verifyHook($config->getValue('journal/title', 'store', $code) === '1', 'Both store code aliases stay valid');
    $replacement = new \Magento\Framework\App\Config(new \Magento\Config\App\Config\Type\System\Replacement);
    verifyHook($replacement->getValue('journal/replacement') === '0', 'A replacement that bypasses the native getter stays unchanged');
    $beforeRendering = Recorder::finish();
    verifyHook(array_column($beforeRendering['events'], null, 'id')['title']['hits'] === 3, 'Decorated reads validate only the native value once per call');
    verifyHook(!in_array('replacement', array_column($beforeRendering['events'], 'id'), true), 'A bypassed native getter cannot invent XML consumption');
    foreach (['backend-value', 'backend-flag'] as $id) verifyHook(in_array($id, array_column($beforeRendering['events'], 'id'), true), 'Backend-only reads must have their own evidence');
    $config->getValue('journal');
    $beforeBulk = Recorder::finish()['events'];
    (new \Magento\Config\App\Config\Type\System)->get('');
    (new \Magento\Config\App\Config\Type\System)->get('default/journal/title');
    $backend->getValue('');
    verifyHook(Recorder::finish()['events'] === $beforeBulk, 'Bulk and direct storage reads outside accessors grant no execution credit');
    verifyHook(array_column(Recorder::finish()['events'], null, 'id')['title']['hits'] === 4, 'Scalar and explicit subtree reads use the same provenance checks');
    $beforeRendering = Recorder::finish();
    $element = new class {
        public function getFieldConfig() { return ['path' => 'journal/display', 'id' => 'title']; }
        public function getScope() { return 'stores'; }
        public function getScopeId() { return 1; }
    };
    $renderer = new \Magento\Config\Block\System\Config\Form\Field;
    $source = new \Magento\Config\Model\Config\Structure\Element\Field(['path' => 'journal/display', 'id' => 'title']);
    $source->getData();
    verifyHook(Recorder::finish()['events'] === $beforeRendering['events'], 'Metadata reads alone do not grant rendering coverage');
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
    verifyHook(count($record['events']) === 8, 'Only selected paths produce evidence');
    verifyHook(array_column($record['events'], null, 'id')['store-title']['requestedScope'] === ['type' => 'stores', 'code' => 'reading'], 'Numeric and singular scope resolved');
    verifyHook($original === hash_file('sha256', __FILE__), 'Hooking cannot rewrite original source');
    verifyHook($record['renderHook'] === true && $record['events'][7]['type'] === 'system-field-render', 'Real native rendering hook');
    verifyHook($record['events'][7]['hits'] === 2, 'Source metadata validates both plain and plugin-decorated rendering');
    $config->getValue('journal/stale');
    try { Recorder::finish(); throw new \LogicException('Stale configuration accepted'); }
    catch (\RuntimeException $exception) { verifyHook(str_contains($exception->getMessage(), 'Cached configuration differs'), 'A stale native value must still fail measurement'); }
    (new \ReflectionProperty(Recorder::class, 'errors'))->setValue(null, []);
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
