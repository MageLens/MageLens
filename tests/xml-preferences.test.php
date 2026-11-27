<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\PreferenceProof;

use MageLens\XmlCoverage\{PreferenceManifest, Preferences, Recorder};
use Magento\Framework\App\{Area, AreaList};
use Magento\Framework\App\ObjectManager as AppObjectManager;
use Magento\Framework\App\ObjectManagerFactory;
use Magento\Framework\App\State;
use Magento\Framework\App\ObjectManager\ConfigCache;
use Magento\Framework\App\ObjectManager\ConfigLoader;
use Magento\Framework\App\ObjectManager\Environment\Developer as Environment;
use Magento\Framework\Config\{Scope, ScopeInterface};
use Magento\Framework\Interception\Config\Config as Interception;
use Magento\Framework\Interception\ConfigInterface;
use Magento\Framework\Interception\ObjectManager\Config\Developer as Config;
use Magento\Framework\ObjectManager\Factory\Dynamic\Developer;
use Magento\Framework\Serialize\Serializer\Serialize;
use Magento\Framework\Serialize\SerializerInterface;
use Magento\Indexer\Console\Command\AbstractIndexerCommand;
use function OpenTelemetry\Instrumentation\hook;

require __DIR__ . '/xml-preference-hook-proof.php';
require getenv('MAGELENS_XML_HOOKS') ?: (require __DIR__ . '/project-root.php') . '/docker/php/xml-hooks.php';

$mode = $argv[2] ?? 'cold';
$collect = $mode !== 'benchmark-baseline';
check(PreferenceManifest::nativeHooks(), 'Pinned native function bodies');
$tracked = [
    First::class => 'first', Second::class => 'second', Chained::class => 'chain', Virtual::class => 'virtual',
    Outer::class => 'outer', Failing::class => 'throwing', SeparateConcrete::class => 'direct-binding',
];
$prepared = [];
$expected = new Config();
$expectedPreferences = new \ReflectionProperty(Config::class, '_preferences');
$expectedVirtualTypes = new \ReflectionProperty(Config::class, '_virtualTypes');
foreach (['global', 'frontend', 'adminhtml'] as $area) {
    $delta = $reader->read($area);
    // The extension instruments a function when first called. Build the
    // expected maps before registration without invoking Config::extend().
    $expectedPreferences->setValue($expected, array_replace($expected->getPreferences(), $delta['preferences'] ?? []));
    if (isset($delta['ProofVirtual'])) $expectedVirtualTypes->setValue($expected, ['ProofVirtual' => $delta['ProofVirtual']['type']]);

    $routes = [];
    foreach ($tracked as $type => $id) {
        [$edges, $terminal, $resolved] = PreferenceManifest::resolve($type, $expected->getPreferences(), $expected->getVirtualTypes());
        if ($edges && $resolved !== null) {
            $routes[$type] = ['terminal' => $terminal, 'resolved' => $resolved, 'ids' => array_map(
                static fn($edge) => $area !== 'global' && $edge === First::class ? 'area-first' : $tracked[$edge], $edges)];
        }
    }
    $prepared[$area] = ['delta' => PreferenceManifest::deltaHash($delta), 'config' => PreferenceManifest::configHash($expected), 'routes' => $routes];
}
if ($collect) foreach (Preferences::hooks($prepared) as [$class, $method, $pre, $post]) {
    if ($mode === 'broken-hook' && $method === 'extend') continue;
    check(hook($class, $method, $pre, $post), "Register $class::$method");
}

$boot = static function () use ($loader, $cache): array {
    $config = new Config();
    $factory = new Developer($config);
    $interception = new class implements ConfigInterface {
        public function hasPlugins($type) { return false; }
        public function initialize($classDefinitions = []) {}
    };
    $areas = (new \ReflectionClass(AreaList::class))->newInstanceWithoutConstructor();
    (new \ReflectionProperty(AreaList::class, '_areas'))->setValue($areas, ['adminhtml' => []]);
    $scope = new Scope($areas);
    $state = new State($scope);
    (new \ReflectionProperty(State::class, 'areaList'))->setValue($state, $areas);
    $shared = [ConfigLoader::class => $loader, ConfigCache::class => new ConfigCache($cache), ScopeInterface::class => $scope,
        SerializerInterface::class => new Serialize(), Interception::class => $interception,
        State::class => $state, \Magento\Framework\ObjectManager\ConfigLoaderInterface::class => $loader];
    $manager = new AppObjectManager($factory, $config, $shared);
    $factory->setObjectManager($manager);
    $environment = (new \ReflectionClass(Environment::class))->newInstanceWithoutConstructor();
    $environment->configureObjectManager($config, $shared);
    return [$manager, $config];
};

$applyFrontend = static function ($manager) use ($loader): void {
    $reflection = new \ReflectionClass(Area::class);
    $nativeArea = $reflection->newInstanceWithoutConstructor();
    foreach (['_code' => 'frontend', '_objectManager' => $manager, '_diConfigLoader' => $loader] as $key => $value) {
        $reflection->getProperty($key)->setValue($nativeArea, $value);
    }
    $nativeArea->load(Area::PART_CONFIG);
};
if ($mode === 'warm') {
    $loader->load('global');
    $loader->load('frontend');
}
if ($mode === 'indexer') {
    $factory = new class($boot) extends ObjectManagerFactory {
        public function __construct(private \Closure $boot) {}
        public function create(array $arguments) { return ($this->boot)()[0]; }
    };
    $command = new class($factory) extends AbstractIndexerCommand {
        public function manager() { return $this->getObjectManager(); }
    };
    $manager = $command->manager();
    check($manager->get(First::class)::class === Override::class, 'Indexer manager loads Admin DI');
    check($manager->create(First::class)::class === Override::class, 'Indexer manager uses Admin preference on create');
    check(Preferences::finish(), 'Native indexer DI load must preserve collection');
    $events = array_values((new \ReflectionProperty(Recorder::class, 'events'))->getValue());
    check(count($events) === 1 && $events[0]['id'] === 'area-first' && $events[0]['area'] === 'adminhtml'
        && $events[0]['hits'] === 2, 'Native indexer DI uses the Admin origin');
    echo "indexer passed\n";
    exit;
}
if (in_array($mode, ['stale-removed', 'stale-retained'], true)) {
    $stale = $reader->read('global');
    if ($mode === 'stale-removed') unset($stale['preferences'][First::class]);
    else $stale['preferences']['RetainedFromOldXml'] = Shared::class;
    $cache->save(serialize($stale), 'global::DiConfig');
}
[$manager, $config] = $boot();
if (str_starts_with($mode, 'benchmark-')) {
    $iterations = 200000;
    $manager->create(\stdClass::class);
    $manager->get(First::class);
    $results = [];
    foreach (['unrelated' => \stdClass::class, 'tracked' => First::class] as $label => $type) {
        $times = [];
        for ($sample = 0; $sample < 5; $sample++) {
            $start = hrtime(true);
            for ($i = 0; $i < $iterations; $i++) $manager->get($type);
            $times[] = (hrtime(true) - $start) / $iterations;
        }
        sort($times);
        $results[$label] = round($times[2], 1);
    }
    $events = array_values((new \ReflectionProperty(Recorder::class, 'events'))->getValue());
    if ($collect) check(Preferences::finish(), 'Healthy benchmark hooks');
    echo json_encode(['mode' => $mode, 'nsPerGet' => $results, 'iterationsPerSample' => $iterations, 'samples' => 5,
        'eventRows' => count($events), 'eventBytes' => strlen(json_encode($events, JSON_THROW_ON_ERROR)),
        'hits' => $events[0]['hits'] ?? 0], JSON_THROW_ON_ERROR), PHP_EOL;
    exit;
}
if ($mode === 'stale-mutation') $config->extend(['preferences' => [First::class => Shared::class]]);
if (str_starts_with($mode, 'stale-') || $mode === 'broken-hook') {
    try {
        Preferences::finish();
        throw new \LogicException('Expected stale provenance rejection');
    } catch (\RuntimeException $error) {
        $reason = $mode === 'broken-hook' ? 'did not confirm the native DI path' : 'differ from prepared XML provenance';
        check(str_contains($error->getMessage(), $reason), 'Invalid hook evidence must prevent publication');
    }
    echo "$mode passed\n";
    exit;
}
$one = $manager->get(First::class);
check($one === $manager->get(Second::class), 'Two bindings share an instance');
check($one === $manager->get(Shared::class), 'Direct lookup bypasses both bindings');
check($one === $manager->get(SeparateConcrete::class), 'A direct concrete request applies its own binding');
check($manager->create(First::class) !== $one, 'Create uses the preference and returns a new instance');
check($manager->get(Chained::class) === $one, 'Chain reaches same shared object');
check($manager->get(Virtual::class)::class === Shared::class, 'Virtual target reaches original concrete implementation');
check($manager->create(Outer::class)->dependency === $one, 'Nested dependency uses the shared path');
try {
    $manager->create(Failing::class);
    throw new \LogicException('Expected constructor failure');
} catch (\RuntimeException $error) {
    check($error->getMessage() === 'proof failure', 'Exception remains unchanged');
}
$config->getPreference(First::class);
$applyFrontend($manager);
check($manager->get(First::class)::class === Override::class, 'Native area applies frontend override');
check(Preferences::finish(), 'Native hooks produced a complete request');

$events = array_values((new \ReflectionProperty(Recorder::class, 'events'))->getValue());
$actual = array_map(static fn($event) => [$event['id'], $event['area'], $event['requested'], $event['hits']], $events);
check($actual === [
    ['first', 'global', First::class, 3],
    ['second', 'global', Second::class, 2],
    ['direct-binding', 'global', SeparateConcrete::class, 1],
    ['chain', 'global', Chained::class, 1],
    ['first', 'global', Chained::class, 1],
    ['virtual', 'global', Virtual::class, 1],
    ['outer', 'global', Outer::class, 1],
    ['area-first', 'frontend', First::class, 1],
], 'Successful preference events retain binding identity, route and area: ' . json_encode($actual));
echo "$mode passed with " . count($events) . " aggregated event rows\n";
