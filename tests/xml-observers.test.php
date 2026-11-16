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
require (getenv('MAGELENS_XML_HOOKS') ?: __DIR__ . '/../docker/php/xml-hooks.php');

function requireObserver(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$root = getenv('MAGELENS_OBSERVER_FIXTURES') ?: '/var/www/html/app/code/Application/Blog/Test/Configuration/fixtures';
$schemaPath = (new ReflectionClass(Observer::class))->getFileName();
$schema = dirname($schemaPath) . '/etc/events.xsd';
$global = file_get_contents($root . '/etc/events.xml');
$frontend = file_get_contents($root . '/etc/frontend/events.xml');
$ids = [];
foreach (['global' => $global, 'frontend' => $frontend] as $scope => $source) {
    $path = $scope === 'global' ? 'etc/events.xml' : 'etc/frontend/events.xml';
    $items = Xml::declarations('app/code/Application/Blog/' . $path, $source, 'events');
    requireObserver($items === Xml::declarations('app/code/Application/Blog/' . $path, str_replace("\n", "\r\n", $source), 'events'),
        'Observer IDs and ranges must agree on CRLF');
    foreach ($items as $item) $ids[$scope][$item['node']] = $item['id'];
}
$resolver = new class($global, $frontend) implements FileResolverInterface {
    public function __construct(private string $global, private string $frontend) {}
    public function get($filename, $scope = null)
    {
        return match ($scope) {
            'global' => ['global' => $this->global],
            'frontend' => ['frontend' => $this->frontend, 'external' => str_replace(
                '<observer name="disabled_in_frontend" disabled="true"/>',
                '<observer name="external_override" instance="External"/><observer name="global_journal" shared="false"/>',
                str_replace('frontend_journal', 'external_earlier', $this->frontend))],
            default => [],
        };
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
$origins = array_replace_recursive($owners['global'], $owners['frontend'])[$event];
$globalItems = array_values($ids['global']);
foreach (['global_journal' => [0, 'ambiguous'], 'disabled_in_frontend' => [1, 'disabled'], 'external_override' => [2, 'overridden']] as $name => [$index, $status]) {
    [$actual] = ObserverManifest::registration($merged[$name], $origins[$name], $globalItems[$index], true, static fn() => 'Probe');
    requireObserver($actual === $status, "Incorrect provenance for $name: $actual");
}
requireObserver($configs['global'][$event]['global_journal']['name'] === 'global_journal', 'Native reader did not convert normalized identity');

class JournalObserverForTest implements ObserverInterface
{
    public static array $actions = [];
    public function execute(Observer $observer): void
    {
        $action = array_shift(self::$actions);
        if ($action) $action();
    }
}
require __DIR__ . '/xml-observer-interceptor.php';
$observer = new \JournalObserverForTest\Interceptor();
$factory = new class($observer) extends ObserverFactory {
    public function __construct(private ObserverInterface $observer) {}
    public function get($className) { return $this->observer; }
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
$eventList = static fn(string ...$names) => array_combine($names, array_map(
    static fn($name) => ['name' => $name, 'instance' => JournalObserverForTest::class], $names));
$runtimeConfig = [$runtimeEvent => $eventList('first', 'second'), $nestedEvent => $eventList('nested')];
$runtimeReader = new class($runtimeConfig) extends Reader {
    public function __construct(private array $config) {}
    public function read($scope = null) { return $scope === 'frontend' ? $this->config : []; }
};
$manager = static fn() => new Manager($invoker, new Config(new Data($runtimeReader, $scope, $cache, 'observer-hook-test', new Json())));
$targets = [];
foreach ($runtimeConfig as $name => $registrations) {
    $targets[$name]['hash'] = ObserverManifest::signature($registrations);
    foreach ($registrations as $key => $config) {
        // A real generated interceptor has a parent observer method. This test
        // intentionally uses the real interception trait's ___callParent path.
        $targets[$name]['targets'][$key] = ['id' => $key, 'class' => JournalObserverForTest::class, 'hash' => ObserverManifest::signature($config)];
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
