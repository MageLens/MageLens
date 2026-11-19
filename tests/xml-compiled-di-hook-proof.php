<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\ProductionProof;

use MageLens\XmlCoverage\{CompiledProvenance, DiUsage, DiUsageManifest, PreferenceManifest, Recorder, Xml};
use Magento\Framework\App\ObjectManager\ConfigLoader\Compiled as CompiledLoader;
use Magento\Framework\App\ObjectManager\ConfigLoader;
use Magento\Framework\Code\Reader\ClassReader;
use Magento\Framework\Interception\ObjectManager\Config\Compiled as InterceptingConfig;
use Magento\Framework\ObjectManager\Config\Compiled as CompiledConfig;
use Magento\Framework\ObjectManager\Config\Config;
use Magento\Framework\ObjectManager\Factory\Compiled as CompiledFactory;
use Magento\Framework\ObjectManager\Factory\Dynamic\Developer;
use Magento\Framework\ObjectManager\ObjectManager;
use Magento\Setup\Module\Di\Code\Reader\ClassReaderDecorator;
use Magento\Setup\Module\Di\Code\Reader\Type;
use Magento\Setup\Module\Di\Compiler\ArgumentsResolverFactory;
use Magento\Setup\Module\Di\Compiler\Config\Chain\PreferencesResolving;
use Magento\Setup\Module\Di\Compiler\Config\Reader;
use Magento\Setup\Module\Di\Definition\Collection;
use function OpenTelemetry\Instrumentation\hook;

require '/var/www/html/vendor/autoload.php';
require getenv('MAGELENS_XML_HOOKS') ?: __DIR__ . '/../docker/php/xml-hooks.php';

interface First {}
interface Second {}
interface Chain {}
interface Broken {}
interface AreaChoice {}
interface VirtualChoice {}
class Service implements First, Second, Chain, AreaChoice, VirtualChoice {}
class FrontendService extends Service {}
class ThrowingService implements Broken
{
    public function __construct() { throw new \DomainException('fixture'); }
}
class Consumer
{
    public function __construct(public First $dependency) {}
}
class ConsumerDirect extends Consumer {}
class NullableConsumer
{
    public function __construct(public array $options, public ?int $limit = 10, public ?int $defaultNull = null) {}
}
class OriginalParent
{
    public function __construct(public string $label) {}
}
class ChangedParent extends OriginalParent {}
class DeferredConsumer
{
    public function __construct(public string $label)
    {
        if ($label === 'throw') throw new \DomainException('fixture');
    }
}
class CallsObjectManager
{
    public static ?ObjectManager $manager = null;

    public function __construct()
    {
        self::$manager->get(First::class);
    }
}
final class AreaLoader extends ConfigLoader
{
    public function __construct() {}
    public function load($area) { return ['preferences' => [AreaChoice::class => FrontendService::class]]; }
}
function check(bool $condition, string $message): void
{
    if (!$condition) throw new \RuntimeException($message);
}
function compile(string $chain, string $area, array $xmlConfig): array
{
    $config = new Config();
    $config->extend([
        'preferences' => [First::class => Service::class, Second::class => Service::class, Chain::class => $chain,
            AreaChoice::class => Service::class, VirtualChoice::class => 'ProbeVirtualA', Broken::class => ThrowingService::class],
        'ProbeVirtualA' => ['type' => 'ProbeVirtualB'],
        'ProbeVirtualB' => ['type' => Service::class],
        DeferredConsumer::class => ['arguments' => ['label' => 'configured']],
        ConsumerDirect::class => ['arguments' => ['dependency' => ['instance' => Service::class]]],
        'ProbeThrowing' => ['type' => DeferredConsumer::class, 'arguments' => ['label' => 'throw']],
    ] + $xmlConfig);
    return compileConfiguration($config, [Service::class, FrontendService::class, Consumer::class, ConsumerDirect::class,
        ThrowingService::class, CallsObjectManager::class, DeferredConsumer::class, NullableConsumer::class], $area);
}

function compileConfiguration(Config $config, array $types, string $area): array
{
    $factory = new Developer($config);
    $manager = new ObjectManager($factory, $config);
    $factory->setObjectManager($manager);
    $classes = new ClassReaderDecorator(new ClassReader());
    $definitions = new Collection();
    foreach ($types as $type) {
        $definitions->addDefinition($type, $classes->getConstructor($type));
    }
    $reader = new Reader($config, new AreaLoader(), new ArgumentsResolverFactory($manager), $classes, new Type());
    return (new PreferencesResolving())->modify($reader->generateCachePerScope($definitions, $area));
}

function fixtureConfiguration(string $fragment, array &$items, array &$origins): array
{
    $source = '<config xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation='
        . '"urn:magento:framework:ObjectManager/etc/config.xsd">' . $fragment . '</config>';
    $document = Xml::document($source);
    $factory = new \ReflectionClass(\Magento\Framework\App\ObjectManagerFactory::class);
    $interpreter = $factory->getMethod('createArgumentInterpreter')->invoke(
        $factory->newInstanceWithoutConstructor(), new \Magento\Framework\Stdlib\BooleanUtils());
    $mapper = new \Magento\Framework\ObjectManager\Config\Mapper\Dom($interpreter);
    $data = $mapper->convert($document);
    $path = 'app/code/Fixture/Native/etc/di.xml';
    $xpath = new \DOMXPath($document);
    $locations = [];
    foreach (Xml::declarations($path, $source, 'arguments') as $item) {
        $id = $item['id'];
        $items[$id] = $item;
        $locations[$id] = ['id' => $id, 'path' => $path];
        DiUsageManifest::annotate($xpath->query($item['node'])->item(0), $id);
    }
    $origins = DiUsageManifest::origins($document, $data, $locations);
    return $data;
}

function nullableConfiguration(array &$usage, array &$ids): array
{
    $type = NullableConsumer::class;
    $items = $origins = [];
    $data = fixtureConfiguration(<<<XML
        <type name="$type"><arguments>
            <argument name="limit" xsi:type="null"/>
            <argument name="defaultNull" xsi:type="null"/>
            <argument name="options" xsi:type="array">
                <item name="group" xsi:type="array"><item name="retained" xsi:type="null"/></item>
            </argument>
        </arguments></type>
        XML, $items, $origins);
    $config = new Config();
    $config->extend($data);
    $usage = DiUsageManifest::prepareArea($items, array_fill_keys(array_keys($items), true), ['global' => $origins],
        $config, ['global'], 'global', null, true, compiled: true);
    $ids = array_column($items, 'id', 'path');
    check(count($usage['eligible']['arguments']) === 5, 'XML null declarations and nested arrays stay in scope');
    return $data;
}

function expectStaleProvenance(array $providers, array $areas): void
{
    try {
        CompiledProvenance::validate($providers, $areas);
        throw new \LogicException('Expected stale compiled provenance');
    } catch (\RuntimeException $error) {
        check(str_contains($error->getMessage(), 'provenance is stale')
            && str_contains($error->getMessage(), './bin/deploy-production'), 'stale compiled provenance requires redeployment');
    }
}

function verifyCompiledProvenance(): void
{
    $directory = tempnam(sys_get_temp_dir(), 'magelens-compiled-');
    unlink($directory);
    define('BP', $directory);
    mkdir($directory . '/app/etc', 0777, true);
    mkdir($directory . '/generated/metadata', 0777, true);
    mkdir($directory . '/app/code/Fixture', 0777, true);
    $source = $directory . '/app/code/Fixture/Consumer.php';
    $environment = $directory . '/app/etc/env.php';
    $session = $directory . '/vendor/magento/framework/Session/SessionManager.php';
    $sessionSource = (new \ReflectionClass(\Magento\Framework\Session\SessionManager::class))->getFileName();
    mkdir(dirname($session), 0777, true);
    $original = '<?php namespace ' . __NAMESPACE__ . '; class ProvenanceConsumer extends OriginalParent {}';
    $files = [$directory . '/app/etc/config.php', $directory . '/composer.lock'];
    $areas = Xml::enabledAreas(['frontend', 'adminhtml', 'webapi_rest', 'crontab', 'webapi_soap']);
    check($areas === ['global', 'frontend', 'adminhtml', 'webapi_rest', 'crontab'], 'Only installed supported scopes are stamped');
    foreach ($areas as $area) $files[] = CompiledLoader::getFilePath($area);
    try {
        foreach ($files as $file) file_put_contents($file, 'fixture');
        file_put_contents($source, $original);
        copy($sessionSource, $session);
        require $source;
        $originalParent = OriginalParent::class;
        $changedParent = ChangedParent::class;
        $diXml = <<<XML
            <type name="$originalParent"><arguments><argument name="label" xsi:type="string">original value</argument></arguments></type>
            <type name="$changedParent"><arguments><argument name="label" xsi:type="string">changed value</argument></arguments></type>
            XML;
        $items = $origins = [];
        $config = new Config();
        $config->extend(fixtureConfiguration($diXml, $items, $origins));
        check($config->getArguments(ChangedParent::class) === ['label' => 'changed value'], 'different parent configuration');
        $providers = ['global' => ['example/etc/di.xml' => hash('sha256', $diXml)]];
        check(CompiledProvenance::validate($providers, $areas) === null, 'deployment has no provenance before compilation');
        file_put_contents($environment, "<?php return ['MAGE_MODE' => 'developer'];");
        $before = CompiledProvenance::inputs($providers);
        $compiled = compileConfiguration($config, [ProvenanceConsumer::class], 'global');
        check($compiled['arguments'][ProvenanceConsumer::class] === ['label' => ['_v_' => 'original value']],
            'native compilation uses the original PHP inheritance');
        file_put_contents(CompiledLoader::getFilePath('global'), '<?php return ' . var_export($compiled, true) . ';');
        file_put_contents($environment, "<?php return ['MAGE_MODE' => 'production'];");
        CompiledProvenance::publish($before, CompiledProvenance::inputs($providers), $areas);
        $metadata = CompiledProvenance::metadata($areas);
        check(CompiledProvenance::validate($providers, $areas) === $metadata, 'compiled provenance round trip');
        $patchPath = '/cypress-patches/magento-framework-session-cookie-race-41057.patch';
        if (!is_file($patchPath)) $patchPath = dirname(__DIR__) . '/patches/cypress/' . basename($patchPath);
        $patch = proc_open(['git', 'apply', '--no-index', '--unidiff-zero', $patchPath],
            [0 => STDIN, 1 => STDOUT, 2 => STDERR], $pipes, $directory);
        check(is_resource($patch) && proc_close($patch) === 0, 'apply the native session fixture patch on a test copy');
        $patchedHash = hash_file('sha256', $session);
        check($patchedHash !== hash_file('sha256', $sessionSource) && CompiledProvenance::validate($providers, $areas) === $metadata
            && hash_file('sha256', $session) === $patchedHash, 'fixture patch preserves provenance and validation leaves source untouched');
        file_put_contents($session, "\n// Unexpected PHP source edit.\n", FILE_APPEND);
        expectStaleProvenance($providers, $areas);
        copy($sessionSource, $session);

        $shared = [];
        $factory = new CompiledFactory(new CompiledConfig($compiled), $shared);
        check($factory->create(ProvenanceConsumer::class)->label === 'original value', 'unchanged compiled constructor injection');
        $events = new \ReflectionProperty(Recorder::class, 'events');
        $evidence = $events->getValue();
        foreach ([
            str_replace('extends OriginalParent', 'extends ChangedParent', $original),
            str_replace('{}', '{ public function __construct(public string $label = "edited") {} }', $original),
        ] as $changed) {
            file_put_contents($source, $changed);
            expectStaleProvenance($providers, $areas);
            check($events->getValue() === $evidence, 'PHP-only changes are rejected before any new DI evidence');
        }
        file_put_contents($source, $original);
        check(CompiledProvenance::validate($providers, $areas) === CompiledProvenance::metadata($areas),
            'restoring the original class restores provenance');
        try {
            CompiledProvenance::validate($providers, [...$areas, 'graphql']);
            throw new \LogicException('Expected missing metadata for the registered area');
        } catch (\RuntimeException $error) {
            check(str_contains($error->getMessage(), 'metadata is missing for graphql'), 'Missing active metadata fails explicitly');
        }
        $edited = ['global' => ['example/etc/di.xml' => hash('sha256', 'edited')]];
        expectStaleProvenance($edited, $areas);
        file_put_contents(CompiledLoader::getFilePath('frontend'), 'changed');
        expectStaleProvenance($providers, $areas);
    } finally {
        foreach (glob($directory . '/generated/metadata/*') as $file) unlink($file);
        unlink($directory . '/composer.lock');
        unlink($directory . '/app/etc/config.php');
        foreach ([$source, $environment, $session] as $file) if (is_file($file)) unlink($file);
        foreach (['/generated/metadata', '/generated', '/app/code/Fixture', '/app/code', '/app/etc', '/app',
            '/vendor/magento/framework/Session', '/vendor/magento/framework', '/vendor/magento', '/vendor', ''] as $path) rmdir($directory . $path);
    }
}

function verifyCompiledLifetimeMask(): void
{
    $config = new Config();
    $config->extend(['preferences' => [First::class => Service::class], First::class => ['shared' => true]]);
    $items = ['shared' => ['family' => 'lifecycles', 'declaredScope' => ['type' => 'global'],
        'binding' => ['declaringType' => First::class, 'shared' => true]]];
    $maps = ['global' => [
        'lifecycles' => [First::class => ['id' => 'shared']],
        'arguments' => [ConsumerDirect::class => ['dependency' => [
            'array' => true, 'kind' => 'object', 'objectType' => Service::class, 'origin' => null,
            'items' => [], 'shared' => null, 'hasShared' => false,
        ]]],
    ]];
    $usage = DiUsageManifest::prepareArea($items, ['shared' => true], $maps, $config, ['global'],
        'global', null, true, compiled: true);
    check($usage['arguments'][ConsumerDirect::class]['dependency']['objectType'] === Service::class,
        'an out-of-scope direct request masks an implicit type lifetime even without tracked preferences');
}

$lookups = $frames = $resolutions = [];
$nativeManager = null;
$brokenHook = false;
foreach (['get' => 71, 'create' => 59] as $method => $line) {
    check(hook(ObjectManager::class, $method,
        static function ($manager, array $parameters) use (&$frames, &$nativeManager, $method, $line) {
            if ($manager !== $nativeManager) return;
            $frames[] = ['method' => $method, 'line' => $line, 'requested' => $parameters[0], 'selected' => null];
        },
        static function ($manager, array $parameters, $result, ?\Throwable $error) use (&$frames, &$resolutions, &$nativeManager, &$brokenHook) {
            if ($manager !== $nativeManager) return;
            $frame = array_pop($frames);
            if (($frame['selected'] ?? null) === null) {
                $brokenHook = true;
                return;
            }
            // get() assigns the chosen type to its parameter. The pre-hook keeps the requested identity.
            if ($error === null && is_object($result) && $frame['requested'] !== $frame['selected']) {
                $resolutions[] = [$frame['method'], $frame['requested'], $frame['selected']];
            }
        }), "native compiled Object Manager $method hook");
}
check(hook(CompiledConfig::class, 'getPreference', null,
    static function ($config, array $parameters, $result, ?\Throwable $error, string $class) use (&$lookups, &$frames, &$brokenHook) {
        $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3);
        $index = array_key_last($frames);
        if ($index === null || $error || $class !== CompiledConfig::class || ($trace[2]['class'] ?? null) !== ObjectManager::class) return;
        $frame = &$frames[$index];
        if (($trace[2]['function'] ?? null) !== $frame['method'] || ($trace[1]['line'] ?? null) !== $frame['line']) return;
        if ($frame['selected'] !== null || $parameters[0] !== $frame['requested']) $brokenHook = true;
        $frame['selected'] = $result;
        $lookups[] = $frame['method'];
    }), 'native compiled config lookup hook');

$nullableUsage = $nullableIds = [];
$xmlConfig = nullableConfiguration($nullableUsage, $nullableIds);
$global = compile(First::class, 'global', $xmlConfig);
$alternate = compile(Second::class, 'global', $xmlConfig);
check($global['arguments'][NullableConsumer::class] === [
    'options' => ['_v_' => ['group' => ['retained' => null]]],
    'limit' => ['_v_' => 10],
    'defaultNull' => ['_vn_' => true],
], 'native compilation keeps constructor defaults and retains nested null');
check($global === $alternate && $global['preferences'][Chain::class] === Service::class,
    'distinct original chains must be indistinguishable in compiled metadata');
check($global['arguments'][Consumer::class]['dependency'] === ['_i_' => Service::class]
    && $global['instanceTypes']['ProbeVirtualA'] === Service::class, 'compiled descriptor and virtual chain');
$lazy = method_exists(CompiledFactory::class, 'resolveArguments');
check(PreferenceManifest::nativeHooks(true), 'verified native compiled method bodies');
if ($lazy) $global['lazyTypes'][DeferredConsumer::class] = true;
$usage = [
    'eligible' => ['arguments' => ['label' => true, 'throwing-label' => true], 'virtual-types' => ['virtual-a' => true, 'virtual-b' => true]],
    'virtualRoutes' => ['ProbeVirtualA' => ['ids' => ['virtual-a', 'virtual-b'], 'resolved' => Service::class]],
    'virtual' => ['ProbeThrowing' => DeferredConsumer::class], 'names' => ['label' => true, 'dependency' => true],
    'preferences' => [First::class => ['ids' => ['first-binding'], 'terminal' => Service::class]],
    'arguments' => [
        ConsumerDirect::class => ['dependency' => ['id' => null, 'array' => true, 'kind' => 'object',
            'objectType' => Service::class, 'shared' => null, 'items' => []]],
        DeferredConsumer::class => ['label' => ['id' => 'label', 'array' => false, 'kind' => 'string', 'objectType' => null, 'shared' => null, 'items' => []]],
        'ProbeThrowing' => ['label' => ['id' => 'throwing-label', 'array' => false, 'kind' => 'string', 'objectType' => null, 'shared' => null, 'items' => []]],
    ],
];
$usage['eligible']['arguments'] += $nullableUsage['eligible']['arguments'];
$usage['names'] += $nullableUsage['names'];
$usage['arguments'] += $nullableUsage['arguments'];
foreach (DiUsage::hooks(['global' => ['compiled' => true, 'lazyCompiled' => $lazy, 'diUsage' => $usage]]) as [$class, $method, $pre, $post]) {
    check(hook($class, $method, $pre, $post), "compiled factory hook $method");
}
$config = new InterceptingConfig($global);
$shared = [];
$factory = new CompiledFactory($config, $shared);
$manager = new ObjectManager($factory, $config, $shared);
$nativeManager = $manager;
CallsObjectManager::$manager = $manager;
$factory->setObjectManager($manager);
DiUsage::area('global', $factory, $config, $usage);

$events = new \ReflectionProperty(Recorder::class, 'events');
$object = $factory->create(DeferredConsumer::class);
check(($events->getValue() === []) === $lazy, 'lazy arguments earn no evidence before initialization');
check($object->label === 'configured', 'native constructor configuration');
$override = $factory->create(DeferredConsumer::class, ['label' => 'caller']);
check($override->label === 'caller', 'call-time override remains effective');
try {
    $throwing = $factory->create('ProbeThrowing');
    $throwing->label;
    throw new \LogicException('Expected configured constructor failure');
} catch (\DomainException) {
}

$nullable = $factory->create(NullableConsumer::class);
check($nullable->limit === 10 && $nullable->defaultNull === null && $nullable->options === ['group' => ['retained' => null]],
    'native compiled factory applies defaults and nested null');
$nullableEvents = array_filter($events->getValue(), static fn($event) => $event['requested'] === NullableConsumer::class);
$type = NullableConsumer::class;
check(array_column($nullableEvents, 'hits', 'id') === [
    $nullableIds["$type/options"] => 1,
    $nullableIds["$type/options[group]"] => 1,
    $nullableIds["$type/options[group][retained]"] => 1,
], 'only the applied array and its nested items earn credit');
$config->getPreference(First::class);
check($manager->get(First::class) === $manager->get(Second::class) && $manager->get(Chain::class) === $manager->get(Service::class),
    'two bindings with a shared object and a direct request');
check($manager->create(First::class) !== $manager->get(First::class), 'successful create and get');
check($manager->get(VirtualChoice::class) instanceof Service, 'terminal virtual alias');
$before = count($lookups);
$consumer = $manager->create(Consumer::class);
check($consumer->dependency === $manager->get(Service::class) && count($lookups) === $before + 2,
    'compiled constructor injection skips Object Manager preference lookup');
$direct = $factory->create(ConsumerDirect::class);
check($direct->dependency === $consumer->dependency, 'the configured direct request shares the same object');
$manager->create(CallsObjectManager::class, ['fixture' => true]);
$warm = $manager->get(AreaChoice::class);
$manager->configure(compile(First::class, 'frontend', $xmlConfig));
check($warm instanceof Service && !$warm instanceof FrontendService
    && $manager->get(AreaChoice::class) instanceof FrontendService, 'frontend area changes effective binding');
try {
    $manager->create(Broken::class, ['fixture' => true]);
    throw new \LogicException('Expected the constructor to throw');
} catch (\DomainException) {
}
check(!$brokenHook && !$frames && count($lookups) === 14 && $resolutions === [
    ['get', First::class, Service::class],
    ['get', Second::class, Service::class],
    ['get', Chain::class, Service::class],
    ['create', First::class, Service::class],
    ['get', First::class, Service::class],
    ['get', VirtualChoice::class, 'ProbeVirtualA'],
    ['get', First::class, Service::class],
    ['get', AreaChoice::class, Service::class],
    ['get', AreaChoice::class, FrontendService::class],
], 'success only, with distinct binding identities and no credit for the throwing return');
$recorded = array_column(array_diff_key($events->getValue(), $nullableEvents), 'hits', 'id');
check($recorded === ['label' => 1, 'virtual-a' => 1, 'virtual-b' => 1, 'first-binding' => 1],
    'compiled collector credits actual construction and selection, including pre-resolved preferences');
$health = DiUsage::finish();
ksort($health);
check($health === ['arguments' => true, 'virtual-types' => true], 'compiled factory hooks are healthy');
verifyCompiledLifetimeMask();
verifyCompiledProvenance();
echo json_encode(['php' => PHP_VERSION, 'otel' => phpversion('opentelemetry'), 'lookups' => count($lookups),
    'successfulBindingResolutions' => count($resolutions),
    'chainsProduceIdenticalMetadata' => true, 'compiledInjectionBypassesPreferenceLookup' => true,
    'sharedAndAreaOverride' => true, 'throwingConstructor' => true, 'staleProvenanceRejected' => true], JSON_THROW_ON_ERROR), PHP_EOL;
