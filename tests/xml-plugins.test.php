<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\PluginTest;

use Creatuity\Interception\Generator\{AreasPluginList, CompiledInterceptor, CompiledPluginList};
use MageLens\XmlCoverage\{InlinePluginManifest, PluginManifest, Plugins, Recorder, Xml};
use Magento\Framework\App\Filesystem\DirectoryList;
use Magento\Framework\App\ObjectManager;
use Magento\Framework\Code\Generator\Io;
use Magento\Framework\Component\{ComponentRegistrar, ComponentRegistrarInterface};
use Magento\Framework\Module\ModuleListInterface;
use Magento\Framework\ObjectManager\ConfigLoaderInterface;
use Magento\Framework\Config\{FileResolverInterface, ScopeInterface, ValidationStateInterface};
use Magento\Framework\Interception\Code\Generator\Interceptor;
use Magento\Framework\Interception\{PluginListGenerator, PluginListInterface};
use Magento\Framework\Interception\Definition\Runtime as PluginDefinitions;
use Magento\Framework\Interception\ObjectManager\Config\Developer;
use Magento\Framework\Interception\PluginList\PluginList;
use Magento\Framework\ObjectManager\Config\Mapper\Dom as Mapper;
use Magento\Framework\ObjectManager\Config\Reader\Dom;
use Magento\Framework\ObjectManager\Config\SchemaLocator;
use Magento\Framework\ObjectManager\Definition\Runtime as ClassDefinitions;
use Magento\Framework\ObjectManager\Relations\Runtime as Relations;
use Magento\Framework\ObjectManagerInterface;
use Psr\Log\NullLogger;

require getenv('MAGELENS_PLUGIN_AUTOLOAD') ?: '/var/www/html/vendor/autoload.php';
require getenv('MAGELENS_XML_HOOKS') ?: __DIR__ . '/../docker/php/xml-hooks.php';

function check(bool $condition, string $message): void
{
    if (!$condition) throw new \RuntimeException($message);
}

interface Contract { public function run(string $mode): string; }
class Subject implements Contract
{
    public function run(string $mode): string { return 'original'; }
    public function reject(mixed $value): void {}
    public function stream(): \Generator { yield 1; yield 2; }
    public function plainStream(): \Generator { yield 1; yield 2; }
}
class Before
{
    public function beforeRun(Subject $subject, string $mode): void
    {
        if ($mode === 'throws') throw new \LogicException('fixture exception');
    }
}
class Invalid
{
    public function beforeReject(Subject $subject, int $value): void {}
}
class Around
{
    public function aroundRun(Subject $subject, callable $proceed, string $mode): string
    {
        if ($mode === 'stop') return 'short';
        if ($mode === 'reenter') return $subject->run('stop');
        return $proceed($mode) . '/' . $proceed($mode);
    }
}
class After
{
    public function afterRun(Subject $subject, string $result): string { return $result . ':after'; }
}
class Touch
{
    public function aroundBeforeRun(Before $plugin, callable $proceed, Subject $subject, string $mode): void
    {
        $proceed($subject, $mode);
    }
}
class Ignored
{
    public function run(string $mode): string { return 'ignored'; }
}
class IgnoredPlugin
{
    public function afterRun(Ignored $subject, string $result): string { return $result; }
}

class DeferredStream
{
    public static int $entries = 0;
    public function beforeStream(Subject $subject): void {}
    public function aroundStream(Subject $subject, callable $proceed): \Generator
    {
        self::$entries++;
        yield from $proceed();
    }
}
class PlainStream
{
    public function aroundPlainStream(Subject $subject, callable $proceed): \Generator { return $proceed(); }
}
class StreamFollower
{
    public static int $afterEntries = 0;
    public function afterStream(Subject $subject, \Generator $result): \Generator
    {
        self::$afterEntries++;
        return $result;
    }
    public function beforePlainStream(Subject $subject): void {}
}

function reader(array $sources): Dom
{
    $resolver = new class($sources) implements FileResolverInterface {
        public function __construct(private array $sources) {}
        public function get($filename, $scope = null) { return $this->sources[$scope] ?? []; }
    };
    $validation = new class implements ValidationStateInterface {
        public function isValidationRequired() { return false; }
    };
    $interpreter = new class implements \Magento\Framework\Data\Argument\InterpreterInterface {
        public function evaluate(array $data) { throw new \LogicException('Unexpected fixture argument'); }
    };
    return new Dom($resolver, new Mapper($interpreter), new SchemaLocator(), $validation);
}

$subject = Subject::class;
$contract = Contract::class;
$beforeType = Before::class;
$afterType = After::class;
$aroundType = Around::class;
$global = <<<XML
<config>
    <type name="$contract">
        <plugin name="one"
                type="$beforeType" sortOrder="10"/>
    </type>
    <type name="$subject">
        <plugin name="two" type="$beforeType" sortOrder="20"/>
        <plugin name="outer" type="$afterType" sortOrder="5"/>
        <plugin name="around" type="$aroundType" sortOrder="30"/>
        <plugin name="inner" type="$afterType" sortOrder="40"/>
    </type>
</config>
XML;
$frontend = <<<XML
<config>
    <type name="$subject"><plugin name="two" type="$beforeType" sortOrder="20"/></type>
</config>
XML;
$admin = <<<XML
<config>
    <type name="$subject"><plugin name="two" sortOrder="21"/></type>
</config>
XML;
$reader = reader(['global' => ['global.xml' => $global], 'frontend' => ['external.xml' => $frontend],
    'adminhtml' => ['admin.xml' => $admin]]);
$schema = 'urn:magento:framework:ObjectManager/etc/config.xsd';
$inventory = str_replace('<config>', '<config xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="' . $schema . '">', $global);
$file = 'app/code/MageLens/PluginTest/etc/di.xml';
$declarations = Xml::declarations($file, $inventory, 'plugins');
check($declarations === Xml::declarations($file, str_replace("\n", "\r\n", $inventory), 'plugins'), 'CRLF changed declaration IDs or ranges');
check([$declarations[0]['startLine'], $declarations[0]['endLine']] === [3, 4], 'Inclusive range missing');
$ids = [];
foreach ($declarations as $declaration) $ids[$declaration['node']] = $declaration['id'];
$reader->read('global'); // Bootstrap can prime the Mage-OS reader before replay.
[, $tagged, , $providers] = PluginManifest::sources($reader, ['global.xml' => $ids]);
check(isset($providers['external.xml']), 'Missing out-of-scope provider');

$scope = new class implements ScopeInterface {
    private string $scope = 'frontend';
    public function getCurrentScope() { return $this->scope; }
    public function setCurrentScope($scope) { $this->scope = $scope; }
};
$relations = new Relations();
$generator = new PluginListGenerator(
    $reader,
    $scope, new Developer(), $relations, new PluginDefinitions(), new ClassDefinitions(), new NullLogger(), new DirectoryList(sys_get_temp_dir())
);
$data = $generator->merge($tagged['global'], []);
$override = $generator->merge($tagged['frontend'], $data);
$multi = $generator->merge($tagged['adminhtml'], $data);
check(!in_array($declarations[1]['id'], PluginManifest::origins($override[$subject]['two']), true), 'External override retained credit');
check(count(PluginManifest::origins($multi[$subject]['two'])) === 2, 'Partial override lost a contributor');

$directory = sys_get_temp_dir() . '/magelens-plugin-test-' . bin2hex(random_bytes(8));
mkdir($directory);
register_shutdown_function(static function () use ($directory): void {
    $entries = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($directory, \FilesystemIterator::SKIP_DOTS),
        \RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($entries as $entry) $entry->isDir() ? rmdir($entry->getPathname()) : unlink($entry->getPathname());
    rmdir($directory);
});

if (!defined('BP')) define('BP', $directory);
$activeModule = 'app/code/MageLens/PluginTestActive';
$inactiveModule = 'app/code/MageLens/PluginTestInactive';
$classes = [
    'MageLens\\PluginTestActive\\InheritedCandidate' => ['MageLens\\PluginTestActive', 'InheritedCandidate', '\\' . Subject::class],
    'MageLens\\PluginTestInactive\\XmlCandidate' => ['MageLens\\PluginTestInactive', 'XmlCandidate', '\\MissingVendor\\OptionalBase'],
    'MageLens\\PluginTestInactive\\ScannedCandidate' => ['MageLens\\PluginTestInactive', 'ScannedCandidate', '\\MissingVendor\\OptionalBase'],
];
foreach ([$activeModule, $inactiveModule] as $module) mkdir($directory . '/' . $module, 0777, true);
foreach ($classes as [$namespace, $class, $parent]) {
    $file = $directory . '/app/code/' . str_replace('\\', '/', $namespace) . '/' . $class . '.php';
    file_put_contents($file, "<?php\nnamespace $namespace;\nclass $class extends $parent {}\n");
}
$autoloaded = [];
$autoload = static function (string $name) use ($classes, $directory, &$autoloaded): void {
    if (!isset($classes[$name])) return;
    $autoloaded[] = $name;
    require $directory . '/app/code/' . str_replace('\\', '/', $name) . '.php';
};
spl_autoload_register($autoload);

$registrar = new ComponentRegistrar();
ComponentRegistrar::register(ComponentRegistrar::MODULE, 'MageLens_PluginTestActive', BP . '/' . $activeModule);
ComponentRegistrar::register(ComponentRegistrar::MODULE, 'MageLens_PluginTestInactive', BP . '/' . $inactiveModule);
$modules = new class implements ModuleListInterface {
    public function getNames() { return ['MageLens_PluginTestActive']; }
    public function getAll() { return array_fill_keys($this->getNames(), []); }
    public function getOne($name) { return $this->getAll()[$name] ?? null; }
    public function has($name) { return in_array($name, $this->getNames(), true); }
};
$streamRegistrations = [
    'deferred_stream' => ['instance' => DeferredStream::class, 'sortOrder' => 10],
    'plain_stream' => ['instance' => PlainStream::class, 'sortOrder' => 20],
    'stream_follower' => ['instance' => StreamFollower::class, 'sortOrder' => 30],
];
$streams = '';
foreach ($streamRegistrations as $name => ['instance' => $instance, 'sortOrder' => $order]) {
    $streams .= "        <plugin name=\"$name\" type=\"$instance\" sortOrder=\"$order\"/>\n";
}
$activeFile = $activeModule . '/etc/di.xml';
$inactiveFile = $inactiveModule . '/etc/di.xml';
$activeXml = str_replace("    </type>\n</config>", $streams . "    </type>\n</config>", $inventory);
$configElement = strtok($inventory, "\n");
$inactiveXml = <<<XML
$configElement
    <type name="MageLens\PluginTestInactive\XmlCandidate">
        <plugin name="inactive" type="$beforeType"/>
    </type>
</config>
XML;
$files = [];
foreach ([$activeFile => $activeXml, $inactiveFile => $inactiveXml] as $path => $bytes) {
    $files[$path] = ['family' => 'plugins', 'sourceHash' => hash('sha256', $bytes), 'declarations' => Xml::declarations($path, $bytes, 'plugins')];
}
$manifestReader = reader(['global' => [BP . '/' . $activeFile => $activeXml]]);
$loader = new class($manifestReader) extends \Magento\Framework\App\ObjectManager\ConfigLoader {
    public function __construct(private Dom $reader) {}
    public function load($area) { return $this->reader->read($area); }
};
$cache = new class implements \Magento\Framework\Config\CacheInterface {
    public function load($identifier) { return false; }
    public function test($identifier) { return false; }
    public function getBackend() { throw new \LogicException('Unexpected cache backend access'); }
    public function getLowLevelFrontend() { throw new \LogicException('Unexpected cache frontend access'); }
    public function save($data, $identifier, $tags = [], $lifeTime = null) { throw new \LogicException('Unexpected cache write'); }
    public function remove($identifier) { throw new \LogicException('Unexpected cache removal'); }
    public function clean($mode = '', $tags = []) { throw new \LogicException('Unexpected cache clean'); }
};
$manifestList = (new \ReflectionClass(PluginList::class))->newInstanceWithoutConstructor();
(new \ReflectionProperty(PluginList::class, '_cache'))->setValue($manifestList, $cache);
$configuration = new Developer();
$configuration->extend(['preferences' => [PluginListInterface::class => PluginList::class]]);
$manifestOm = new class([
    Dom::class => $manifestReader, ConfigLoaderInterface::class => $loader, PluginListGenerator::class => $generator,
    \Magento\Framework\Interception\ObjectManager\ConfigInterface::class => $configuration, PluginListInterface::class => $manifestList,
    ModuleListInterface::class => $modules, ComponentRegistrarInterface::class => $registrar,
]) {
    public function __construct(private array $instances) {}
    public function get(string $type): object { return $this->instances[$type]; }
};
[$manifest] = PluginManifest::prepare($manifestOm, $files, [
    "src/$activeModule/InheritedCandidate.php", "src/$inactiveModule/ScannedCandidate.php",
], $directory);
spl_autoload_unregister($autoload);
check($autoloaded === ['MageLens\\PluginTestActive\\InheritedCandidate'], 'Manifest autoloaded an inactive subject or missed an active descendant');
$inactive = $files[$inactiveFile]['declarations'][0]['areas']['global'];
check($inactive['status'] === 'unsupported' && str_contains($inactive['reason'], 'inactive'), 'Inactive declaration did not stay unmeasured');
check(isset($manifest['frontend']['MageLens\\PluginTestActive\\InheritedCandidate']['targets']['one']['run']['before']),
    'Active conventional subject lost inherited coverage');
$streamDeclarations = array_column($files[$activeFile]['declarations'], null, 'path');
$streamArea = static fn(string $name) => $streamDeclarations[$subject . '/' . $name]['areas']['frontend'];
$mixed = $streamArea('deferred_stream');
$phases = static fn(array $callbacks) => array_values(array_unique(array_column($callbacks, 'phase')));
check($mixed['status'] === 'eligible' && $phases($mixed['callbacks']) === ['before']
    && $phases($mixed['unmeasuredCallbacks']) === ['around'], 'Mixed generator registration lost a supported callback');
check($phases($streamArea('stream_follower')['unmeasuredCallbacks']) === ['after'], 'Deferred proceed lost its measurement limitation');
$streamTargets = $manifest['frontend'][$subject]['targets'];
check(isset($streamTargets['plain_stream']['plainStream']['around'], $streamTargets['stream_follower']['plainStream']['before'])
    && !isset($streamTargets['deferred_stream']['stream']['around'], $streamTargets['stream_follower']['stream']['after']),
    'Manifest did not distinguish synchronous and deferred stream callbacks');

$data[$subject] += $streamRegistrations;
$data[$subject]['invalid'] = ['instance' => Invalid::class];
$data[Before::class] = ['touch' => ['instance' => Touch::class]];
$data[Ignored::class] = ['ignored' => ['instance' => IgnoredPlugin::class]];
$list = (new \ReflectionClass(PluginList::class))->newInstanceWithoutConstructor();
$inherited = $processed = [];
foreach ([Subject::class, Before::class, Ignored::class] as $type) {
    $generator->inheritPlugins($type, $data, $inherited, $processed);
}
check(PluginManifest::origins($inherited[$subject]['one']) === [$declarations[0]['id']], 'Inherited origin changed');
$native = static function (array $plugins): array {
    foreach ($plugins as &$plugin) $plugin = array_filter($plugin, static fn($key) => !str_starts_with($key, 'magelens-origin-'), ARRAY_FILTER_USE_KEY);
    return $plugins;
};
$data = array_map($native, $data);
$inherited = array_map($native, $inherited);
$expected = ['signature' => PluginManifest::signature($inherited[$subject]), 'chains' => [], 'targets' => []];
foreach (['run', 'reject', 'stream', 'plainStream'] as $method) $expected['chains'][$method] = PluginManifest::chain($processed, $subject, $method);
foreach (['one' => ['before', Before::class], 'two' => ['before', Before::class], 'around' => ['around', Around::class],
    'inner' => ['after', After::class], 'outer' => ['after', After::class]] as $name => [$phase, $class]) {
    $expected['targets'][$name]['run'][$phase] = ['id' => $name, 'implementation' => $class, 'class' => $class, 'callback' => $phase . 'Run'];
}
$expected['targets']['invalid']['reject']['before'] = [
    'id' => 'invalid', 'implementation' => Invalid::class, 'class' => Invalid::class, 'callback' => 'beforeReject',
];
$expected['targets'] += array_intersect_key($streamTargets, $streamRegistrations);
(new \ReflectionProperty(PluginList::class, 'pluginListGenerator'))->setValue($list, $generator);
PluginManifest::validateList($list, [$subject => $expected], [$data, [], []]); // cold
PluginManifest::validateList($list, [$subject => $expected], [$data, $inherited, $processed]); // warm
$compiled = $inherited;
$compiled[$subject]['disabled-in-parent'] = ['instance' => Before::class, 'disabled' => true, 'sortOrder' => 90];
PluginManifest::validateList($list, [$subject => $expected], [$data, $compiled, $processed]);
$compiled[$subject]['disabled-in-parent']['disabled'] = false;
try {
    PluginManifest::validateList($list, [$subject => $expected], [$data, $compiled, $processed]);
    throw new \LogicException('Unexpected enabled registration accepted');
} catch (\RuntimeException $error) {
    check(str_contains($error->getMessage(), 'registrations differ'), 'An enabled registration must still match XML provenance');
}
$stale = $processed;
unset($stale[$subject . '_reject___self']); // selectable, but absent from the cached chain
try {
    PluginManifest::validateList($list, [$subject => $expected], [$data, $inherited, $stale]);
    throw new \LogicException('Missing callback accepted');
} catch (\RuntimeException $error) {
    check(str_contains($error->getMessage(), 'chains differ'), 'Wrong stale provenance failure');
}

$mode = $argv[1] ?? '';
$inline = in_array('inline', $argv, true);
$staleInline = in_array('stale-inline', $argv, true);
$objectManager = new class($list, $generator) implements ObjectManagerInterface {
    public array $instances = [];
    public function __construct(private PluginList $list, private PluginListGenerator $generator) {}
    public function create($type, array $arguments = []) { throw new \LogicException(); }
    public function get($type) {
        return match ($type) {
            PluginListInterface::class => $this->list,
            PluginListGenerator::class => $this->generator,
            default => $this->instances[$type] ?? throw new \LogicException(),
        };
    }
    public function configure(array $configuration) { throw new \LogicException(); }
};
ObjectManager::setInstance($objectManager);
$io = new Io(new \Magento\Framework\Filesystem\Driver\File(), $directory);
$instances = [];
$areas = null;
if ($inline) {
    // Feed the generator the native chain snapshot without calling the
    // runtime getNext method before its OpenTelemetry hook can be installed.
    $compiled = new class($inherited, $processed) extends CompiledPluginList {
        public function __construct(array $inherited, array $processed)
        {
            $this->_inherited = $inherited;
            $this->_processed = $processed;
        }
        public function getNext($type, $method, $code = '__self')
        {
            return $this->_processed[$type . '_' . lcfirst($method) . '_' . $code] ?? null;
        }
    };
    $compiledScope = (new \ReflectionClass(\Magento\Framework\Config\Scope::class))->newInstanceWithoutConstructor();
    $areas = new AreasPluginList($compiledScope, ['global' => $compiled, 'frontend' => $compiled]);
    $source = "<?php\n" . (new \ReflectionMethod(CompiledInterceptor::class, '_generateCode'))
        ->invoke(new CompiledInterceptor($areas, $subject, $subject . '\\Interceptor', $io));
    $expected['inline'] = ['hash' => InlinePluginManifest::hash($source), 'sites' => InlinePluginManifest::sites($source)];
    check(count($expected['inline']['sites']) === 11, 'Generated callback sites are incomplete');
}
if ($mode !== 'baseline') foreach (Plugins::hooks(array_fill_keys(['frontend', 'global'], [$subject => $expected])) as $hook) {
    check(\OpenTelemetry\Instrumentation\hook(...$hook), 'Could not install hook before invocation');
}
foreach ([Subject::class, Before::class, Ignored::class] as $type) {
    $wrapper = $type . '\\Interceptor';
    $code = $inline ? new CompiledInterceptor($areas, $type, $wrapper, $io) : new Interceptor($type, $wrapper, $io);
    $path = $code->generate();
    check(is_string($path), implode("\n", $code->getErrors()));
    if ($inline && $staleInline && $type === $subject) file_put_contents($path, "\n// stale generated fixture\n", FILE_APPEND);
    require $path;
    $instances[$type] = $inline ? new $wrapper($objectManager, $scope) : new $wrapper();
}
$plugin = $instances[Before::class];
$after = new After();
$objectManager->instances = [Before::class => $plugin, After::class => $after, Around::class => new Around(),
    Touch::class => new Touch(), Invalid::class => new Invalid(), IgnoredPlugin::class => new IgnoredPlugin(),
    DeferredStream::class => new DeferredStream(), PlainStream::class => new PlainStream(), StreamFollower::class => new StreamFollower()];
foreach (['_configScope' => $scope, '_loadedScopes' => ['frontend' => true, 'global' => true],
    '_data' => $data, '_inherited' => $inherited, '_processed' => $processed,
    '_pluginInstances' => [$subject => ['one' => $plugin, 'two' => $plugin, 'around' => new Around(), 'outer' => $after, 'inner' => $after, 'invalid' => new Invalid(),
        'deferred_stream' => $objectManager->instances[DeferredStream::class], 'plain_stream' => $objectManager->instances[PlainStream::class],
        'stream_follower' => $objectManager->instances[StreamFollower::class]],
        Before::class => ['touch' => new Touch()], Ignored::class => ['ignored' => new IgnoredPlugin()]],
] as $name => $value) (new \ReflectionProperty(PluginList::class, $name))->setValue($list, $value);

$target = $instances[$subject];
if ($staleInline) {
    $target->run('stop');
    try {
        Plugins::finish();
    } catch (\RuntimeException $error) {
        check(str_contains($error->getMessage(), 'interceptor differs'), 'Wrong stale interceptor failure');
        echo "Rejected stale generated plugin interceptor.\n";
        exit;
    }
    throw new \RuntimeException('Accepted stale generated interceptor');
}
$events = static fn() => array_values((new \ReflectionProperty(Recorder::class, 'events'))->getValue());
if (in_array($mode, ['baseline', 'benchmark'], true)) {
    $number = 20000;
    $sizes = [];
    foreach (['unrelated' => $instances[Ignored::class], 'tracked' => $target] as $scenario => $instance) {
        $instance->run('stop');
        $firstBytes = strlen(json_encode($events(), JSON_THROW_ON_ERROR));
        $start = hrtime(true);
        for ($i = 0; $i < $number; $i++) $instance->run('stop');
        $sizes[$scenario] = ['nsPerDispatch' => (hrtime(true) - $start) / $number,
            'singleDispatchBytes' => $firstBytes, 'events' => count($events()), 'jsonBytes' => strlen(json_encode($events(), JSON_THROW_ON_ERROR))];
    }
    echo json_encode($sizes, JSON_THROW_ON_ERROR), "\n";
    exit;
}
check($target->run('stop') === 'short:after', 'Short-circuit skipped an enclosing after callback');
check($target->run('repeat') === 'original:after/original:after:after', 'Repeated proceed behavior changed');
check($target->run('reenter') === 'short:after:after', 'Re-entry behavior changed');
try {
    $target->run('throws');
    throw new \RuntimeException('Expected callback exception');
} catch (\LogicException) {}
try {
    $target->reject([]);
    throw new \RuntimeException('Expected PHP parameter rejection');
} catch (\TypeError) {}
$plugin->beforeRun($target, 'direct');
$list->getPlugin($subject, 'one');
check($target->run('stop') === 'short:after', 'Interrupted context affected later execution');
$pendingStream = $target->stream();
check(DeferredStream::$entries === 0 && StreamFollower::$afterEntries === 0, 'Creating a generator ran its body');
check(iterator_to_array($pendingStream) === [1, 2] && DeferredStream::$entries === 1 && StreamFollower::$afterEntries === 1,
    'Resuming the intercepted generator changed application behavior');
check(iterator_to_array($target->plainStream()) === [1, 2], 'Synchronous generator-returning control changed behavior');
[$healthy, $unconfirmed] = Plugins::finish();
check($healthy && isset($unconfirmed['invalid']['frontend'][PluginManifest::callbackKey(
    ['subject' => $subject, 'method' => 'reject', 'phase' => 'before']
)]), 'Invalid arguments must leave entry unconfirmed');
$streamEvents = array_filter($events(), static fn($event) => in_array($event['callback']['method'], ['stream', 'plainStream'], true));
$streams = array_map(static fn($event) => [$event['name'], $event['callback']['phase'], $event['hits']], array_values($streamEvents));
check($streams === [['deferred_stream', 'before', 1], ['stream_follower', 'before', 1], ['plain_stream', 'around', 1]],
    'Generator creation or deferred callbacks received credit: ' . json_encode($streams));
$hits = array_column(array_diff_key($events(), $streamEvents), 'hits', 'name');
check($hits === ['one' => 6, 'two' => 5, 'around' => 5, 'outer' => 5, 'inner' => 2], 'Unexpected callback evidence: ' . json_encode($hits));
$scope->setCurrentScope('global');
check($target->run('stop') === 'short:after', 'Global interception changed');
check(count(array_filter($events(), static fn($event) => $event['area'] === 'global')) === 4, 'Global scope lost callback identity');
echo "Plugin DI reader, provenance, cold and warm chain validation, and native hook checks passed.\n";
