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
$provider = new class(['global' => ['global.xml' => $global], 'frontend' => ['external.xml' => $frontend],
    'adminhtml' => ['admin.xml' => $admin]]) implements FileResolverInterface {
    public function __construct(private array $scopes) {}
    public function get($filename, $scope = null) { return $this->scopes[$scope] ?? []; }
};
$validation = new class implements ValidationStateInterface {
    public function isValidationRequired() { return false; }
};
$interpreter = new class implements \Magento\Framework\Data\Argument\InterpreterInterface {
    public function evaluate(array $data) { throw new \LogicException('Unexpected fixture argument'); }
};
$schema = 'urn:magento:framework:ObjectManager/etc/config.xsd';
$inventory = str_replace('<config>', '<config xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="' . $schema . '">', $global);
$file = 'app/code/MageLens/PluginTest/etc/di.xml';
$declarations = Xml::declarations($file, $inventory, 'plugins');
check($declarations === Xml::declarations($file, str_replace("\n", "\r\n", $inventory), 'plugins'), 'CRLF changed declaration IDs or ranges');
check([$declarations[0]['startLine'], $declarations[0]['endLine']] === [3, 4], 'Inclusive range missing');
$ids = [];
foreach ($declarations as $declaration) $ids[$declaration['node']] = $declaration['id'];
$reader = new Dom($provider, new Mapper($interpreter), new SchemaLocator(), $validation);
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
    new Dom($provider, new Mapper($interpreter), new SchemaLocator(), $validation),
    $scope, new Developer(), $relations, new PluginDefinitions(), new ClassDefinitions(), new NullLogger(), new DirectoryList(sys_get_temp_dir())
);
$data = $generator->merge($tagged['global'], []);
$override = $generator->merge($tagged['frontend'], $data);
$multi = $generator->merge($tagged['adminhtml'], $data);
check(!in_array($declarations[1]['id'], PluginManifest::origins($override[$subject]['two']), true), 'External override retained credit');
check(count(PluginManifest::origins($multi[$subject]['two'])) === 2, 'Partial override lost a contributor');

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
foreach (['run', 'reject'] as $method) $expected['chains'][$method] = PluginManifest::chain($processed, $subject, $method);
foreach (['one' => ['before', Before::class], 'two' => ['before', Before::class], 'around' => ['around', Around::class],
    'inner' => ['after', After::class], 'outer' => ['after', After::class]] as $name => [$phase, $class]) {
    $expected['targets'][$name]['run'][$phase] = ['id' => $name, 'implementation' => $class, 'class' => $class, 'callback' => $phase . 'Run'];
}
$expected['targets']['invalid']['reject']['before'] = [
    'id' => 'invalid', 'implementation' => Invalid::class, 'class' => Invalid::class, 'callback' => 'beforeReject',
];
(new \ReflectionProperty(PluginList::class, 'pluginListGenerator'))->setValue($list, $generator);
PluginManifest::validateList($list, [$subject => $expected], [$data, [], []]); // cold
PluginManifest::validateList($list, [$subject => $expected], [$data, $inherited, $processed]); // warm
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
$directory = sys_get_temp_dir() . '/magelens-plugin-test-' . bin2hex(random_bytes(8));
mkdir($directory);
register_shutdown_function(static function () use ($directory): void {
    $entries = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($directory, \FilesystemIterator::SKIP_DOTS),
        \RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($entries as $entry) $entry->isDir() ? rmdir($entry->getPathname()) : unlink($entry->getPathname());
    rmdir($directory);
});
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
    check(count($expected['inline']['sites']) === 6, 'Generated callback sites are incomplete');
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
    Touch::class => new Touch(), Invalid::class => new Invalid(), IgnoredPlugin::class => new IgnoredPlugin()];
foreach (['_configScope' => $scope, '_loadedScopes' => ['frontend' => true, 'global' => true],
    '_data' => $data, '_inherited' => $inherited, '_processed' => $processed,
    '_pluginInstances' => [$subject => ['one' => $plugin, 'two' => $plugin, 'around' => new Around(), 'outer' => $after, 'inner' => $after, 'invalid' => new Invalid()],
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
[$healthy, $unconfirmed] = Plugins::finish();
check($healthy && isset($unconfirmed['invalid']['frontend'][PluginManifest::callbackKey(
    ['subject' => $subject, 'method' => 'reject', 'phase' => 'before']
)]), 'Invalid arguments must leave entry unconfirmed');
$hits = array_column($events(), 'hits', 'name');
check($hits === ['one' => 6, 'two' => 5, 'around' => 5, 'outer' => 5, 'inner' => 2], 'Unexpected callback evidence: ' . json_encode($hits));
$scope->setCurrentScope('global');
check($target->run('stop') === 'short:after', 'Global interception changed');
check(count(array_filter($events(), static fn($event) => $event['area'] === 'global')) === 4, 'Global scope lost callback identity');
echo "Plugin DI reader, provenance, cold and warm chain validation, and native hook checks passed.\n";
