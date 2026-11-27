<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

use MageLens\XmlCoverage\{ObserverManifest, Recorder, Xml};
use Magento\Framework\Config\{CacheInterface, FileResolverInterface, ValidationStateInterface};
use Magento\Framework\Event\{Config, Manager, Observer, ObserverFactory, ObserverInterface};
use Magento\Framework\Event\Config\{Converter, Data, Reader, SchemaLocator};
use Magento\Framework\Event\Invoker\InvokerDefault;
use Magento\Framework\Serialize\Serializer\Json;

require getenv('MAGELENS_EVENT_AUTOLOAD') ?: '/var/www/html/vendor/autoload.php';
require (getenv('MAGELENS_XML_HOOKS') ?: (require __DIR__ . '/project-root.php') . '/docker/php/xml-hooks.php');

function requireObserver(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$root = getenv('MAGELENS_OBSERVER_FIXTURES') ?: '/var/www/html/app/code/Application/Blog/Test/Configuration/fixtures';
$schemaPath = (new ReflectionClass(Observer::class))->getFileName();
$schema = dirname($schemaPath) . '/etc/events.xsd';
$global = file_get_contents($root . '/etc/events.xml');
$frontend = file_get_contents($root . '/etc/frontend/events.xml');
$defaultXml = static fn(string $observers) => <<<XML
<config xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:noNamespaceSchemaLocation="urn:magento:framework:Event/etc/events.xsd">
    <event name="default_observers">
$observers
    </event>
</config>
XML;
$files = [
    'global' => [
        'global' => $global,
        'defaults_before' => $defaultXml(<<<'XML'
    <observer name="enabled" instance="Probe" disabled="true"/>
    <observer name="shared" instance="Probe" shared="false"/>
    <observer name="cross_area" instance="Probe" disabled="true" shared="false"/>
XML),
        'defaults_after' => $defaultXml(<<<'XML'
    <observer name="enabled" disabled="false"/>
    <observer name="shared" shared="true"/>
XML),
    ],
    'frontend' => [
        'frontend' => $frontend,
        'external' => str_replace(
            '<observer name="disabled_in_frontend" disabled="true"/>',
            '<observer name="external_override" instance="External"/><observer name="global_journal" shared="false"/>',
            str_replace('frontend_journal', 'external_earlier', $frontend)
        ),
        'frontend_defaults' => $defaultXml(<<<'XML'
    <observer name="cross_area" disabled="false" shared="true"/>
XML),
    ],
];
$ids = [];
foreach (['global' => $global, 'frontend' => $frontend] as $scope => $source) {
    $path = $scope === 'global' ? 'etc/events.xml' : 'etc/frontend/events.xml';
    $items = Xml::declarations('app/code/Application/Blog/' . $path, $source, 'events');
    requireObserver($items === Xml::declarations('app/code/Application/Blog/' . $path, str_replace("\n", "\r\n", $source), 'events'),
        'Observer IDs and ranges must agree on CRLF');
    foreach ($items as $item) $ids[$scope][$item['node']] = $item['id'];
}
$defaultIds = [];
foreach (['defaults_before', 'defaults_after', 'frontend_defaults'] as $file) {
    $scope = $file === 'frontend_defaults' ? 'frontend' : 'global';
    foreach (Xml::declarations("$file/etc/events.xml", $files[$scope][$file], 'events') as $item) {
        $ids[$file][$item['node']] = $defaultIds[$file][$item['registration']['observer']] = $item['id'];
    }
}
$resolver = new class($files) implements FileResolverInterface {
    public function __construct(private array $files) {}
    public function get($filename, $scope = null)
    {
        return $this->files[$scope] ?? [];
    }
};
$schemaLocator = new class($schema) extends SchemaLocator {
    public function __construct(private string $file) {}
    public function getSchema() { return $this->file; }
    public function getPerFileSchema() { return $this->file; }
};
$validation = new class implements ValidationStateInterface {
    public function isValidationRequired() { return true; }
};
$reader = new Reader($resolver, new Converter(), $schemaLocator, $validation);
[$configs, $owners] = ObserverManifest::read($reader, $ids);
$event = 'magelens_journal_observers';
$merged = array_replace_recursive($configs['global'], $configs['frontend'])[$event];
$scopedOwners = ObserverManifest::mergeOrigins($configs['global'], $configs['frontend'], $owners['global'], $owners['frontend']);
$origins = $scopedOwners[$event];
$globalItems = array_values($ids['global']);
foreach (['global_journal' => [0, 'ambiguous'], 'disabled_in_frontend' => [1, 'disabled'], 'external_override' => [2, 'overridden']] as $name => [$index, $status]) {
    [$actual] = ObserverManifest::registration($merged[$name], $origins[$name], $globalItems[$index], true, static fn() => 'Probe');
    requireObserver($actual === $status, "Incorrect provenance for $name: $actual");
}
requireObserver($configs['global'][$event]['global_journal']['name'] === 'global_journal', 'Native reader did not convert normalized identity');

$defaults = $configs['global']['default_observers'];
$defaultOrigins = $owners['global']['default_observers'];
$implementation = static fn() => 'Probe';
foreach (['enabled' => 'disabled', 'shared' => 'shared'] as $name => $attribute) {
    requireObserver(!array_key_exists($attribute, $defaults[$name]), "Native converter retained default '$attribute'");
    foreach (['defaults_before', 'defaults_after'] as $file) {
        [$status] = ObserverManifest::registration($defaults[$name], $defaultOrigins[$name], $defaultIds[$file][$name], true, $implementation);
        requireObserver($status === 'ambiguous', "Incorrect provenance for '$name' in '$file': $status");
    }
}
$crossArea = 'cross_area';
$crossAreaConfig = array_replace($defaults[$crossArea], $configs['frontend']['default_observers'][$crossArea]);
$crossAreaOrigins = $scopedOwners['default_observers'][$crossArea];
foreach (['disabled' => true, 'shared' => false] as $attribute => $value) {
    requireObserver($crossAreaConfig[$attribute] === $value, "Scoped configuration lost the global '$attribute' value");
    requireObserver($crossAreaOrigins[$attribute] === $defaultIds['defaults_before'][$crossArea],
        "Scoped provenance lost the global '$attribute' owner");
}

class JournalObserverForTest implements ObserverInterface
{
    public static array $actions = [];
    public function execute(Observer $observer): void
    {
        $action = array_shift(self::$actions);
        if ($action) $action();
    }
}

class BaseObserverForTest
{
    public int $executions = 0;

    public function execute(Observer $observer): void
    {
        $this->executions++;
    }
}

class InheritedObserverForTest extends BaseObserverForTest implements ObserverInterface
{
}

require __DIR__ . '/xml-observer-interceptor.php';
$observer = new \JournalObserverForTest\Interceptor();
$inherited = new InheritedObserverForTest();
$factory = new class([JournalObserverForTest::class => $observer, InheritedObserverForTest::class => $inherited]) extends ObserverFactory {
    public function __construct(private array $observers) {}
    public function get($className) { return $this->observers[$className]; }
};
$scope = new class implements \Magento\Framework\Config\ScopeInterface {
    public function getCurrentScope() { return 'frontend'; }
    public function setCurrentScope($scope) {}
};
$cache = new class implements CacheInterface {
    public array $data = [];
    public function test($identifier) { return false; }
    public function getBackend() { throw new LogicException("Unused in this test"); }
    public function getLowLevelFrontend() { throw new LogicException("Unused in this test"); }
    public function load($identifier) { return $this->data[$identifier] ?? false; }
    public function save($data, $identifier, array $tags = [], $lifeTime = null) { $this->data[$identifier] = $data; return true; }
    public function remove($identifier) { unset($this->data[$identifier]); return true; }
    public function clean($mode = \Magento\Framework\Cache\CacheConstants::CLEANING_MODE_ALL, array $tags = []) { $this->data = []; return true; }
};
$state = (new ReflectionClass(\Magento\Framework\App\State::class))->newInstanceWithoutConstructor();
$invoker = new InvokerDefault($factory, $state, new \Psr\Log\NullLogger());
$runtimeEvent = 'observer_hook_test';
$nestedEvent = 'observer_hook_nested';
$inheritedEvent = 'observer_hook_inherited';
$eventList = static fn(string ...$names) => array_combine($names, array_map(
    static fn($name) => ['name' => $name, 'instance' => JournalObserverForTest::class], $names));
$runtimeConfig = [
    $runtimeEvent => $eventList('first', 'second'),
    $nestedEvent => $eventList('nested'),
    $inheritedEvent => ['inherited' => ['name' => 'inherited', 'instance' => InheritedObserverForTest::class]],
];
$runtimeReader = new class($runtimeConfig) extends Reader {
    public function __construct(private array $config) {}
    public function read($scope = null) { return $scope === 'frontend' ? $this->config : []; }
};
$manager = static fn() => new Manager($invoker, new Config(new Data($runtimeReader, $scope, $cache, 'observer-hook-test', new Json())));
$targets = [];
foreach ($runtimeConfig as $name => $registrations) {
    $targets[$name]['hash'] = ObserverManifest::signature($registrations);
    foreach ($registrations as $key => $config) {
        $method = new ReflectionMethod($config['instance'], 'execute');
        $targets[$name]['targets'][$key] = [
            'id' => $key,
            'class' => $method->getDeclaringClass()->getName(),
            'hash' => ObserverManifest::signature($config),
        ];
    }
}
$manifestPath = '/coverage/xml-collector.json';
if (file_exists($manifestPath)) throw new RuntimeException('Run this test in an isolated coverage directory');
file_put_contents($manifestPath, json_encode(['run' => 'observer-test', 'id' => 'native', 'observers' => ['frontend' => $targets]], JSON_THROW_ON_ERROR));
try {
    startXmlHooks('observer-test');
    $cold = $manager();
    $observer->shortCircuit = true;
    $cold->dispatch($runtimeEvent);
    $empty = Recorder::finish();
    requireObserver($empty['observerHook'] && !$empty['events'], 'A healthy request may have zero observer execution');
    $observer->shortCircuit = false;
    JournalObserverForTest::$actions = [
        static function () use ($cold) { $cold->dispatch('OBSERVER_HOOK_NESTED'); throw new LogicException('observer test exception'); },
        null,
    ];
    try {
        $cold->dispatch($runtimeEvent, ['event' => 'payload must not provide identity']);
        throw new RuntimeException('Observer did not throw');
    } catch (LogicException $error) {
        requireObserver($error->getMessage() === 'observer test exception', 'Observer exception changed');
    }
    $observer->execute(new Observer()); // Direct execution after an exception must not borrow context.
    $warm = $manager();
    $warm->dispatch($runtimeEvent);
    $record = Recorder::finish();
    requireObserver($record['observerHook'], 'Native observer hook self-check failed');
    requireObserver(array_column($record['events'], 'hits', 'id') === ['first' => 2, 'nested' => 1, 'second' => 1],
        'Short circuit, nesting, shared classes, or exception cleanup misattributed: ' . json_encode($record));
    $warm->dispatch($inheritedEvent);
    requireObserver($inherited->executions === 1, 'The inherited observer did not execute');
    $hits = array_column(Recorder::finish()['events'], 'hits', 'id');
    requireObserver(($hits['inherited'] ?? 0) === 1, 'The inherited observer must receive exactly one execution hit');
    $key = 'frontend::observer-hook-test';
    $cache->data[$key] = json_encode([$runtimeEvent => $eventList('second')], JSON_THROW_ON_ERROR);
    $manager()->dispatch($runtimeEvent);
    try {
        Recorder::finish();
        throw new LogicException('Stale observer cache accepted');
    } catch (RuntimeException $error) {
        requireObserver(str_contains($error->getMessage(), 'Cached event registrations differ'), 'Stale observer cache diagnostic missing');
    }
} finally {
    unlink($manifestPath);
}
echo "Native observer hooks, reader provenance, and warm/stale caches passed.\n";
