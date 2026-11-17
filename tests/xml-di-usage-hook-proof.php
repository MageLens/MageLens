<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\DiUsageProof;

use MageLens\XmlCoverage\{DiUsage, DiUsageManifest, PreferenceManifest, Recorder, Xml};
use Magento\Framework\Interception\ObjectManager\Config\Developer as Config;
use Magento\Framework\ObjectManager\Config\Config as NativeConfig;
use Magento\Framework\ObjectManager\Factory\Dynamic\Developer;
use Magento\Framework\ObjectManager\ObjectManager;
use function OpenTelemetry\Instrumentation\hook;

require ($argv[1] ?? '/var/www/html/vendor') . '/autoload.php';

class Example
{
    public function __construct(public string $label, public array $options, public Nested $dependency)
    {
        if ($label === 'throw') throw new \DomainException('fixture');
    }
}
class Derived extends Example {}
class Nested
{
    public function __construct(public string $tag = 'default') {}
}
function verify(bool $condition, string $message): void
{
    if (!$condition) throw new \RuntimeException($message);
}

function verifyProvenance(): void
{
    $document = static fn(string $value, string $metadata) => Xml::document(
        '<config xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><type name="Probe"><arguments>'
        . '<argument name="service" xsi:type="object"' . $metadata . '>' . $value . '</argument>'
        . '</arguments></type></config>'
    );
    $validation = new class implements \Magento\Framework\Config\ValidationStateInterface {
        public function isValidationRequired() { return false; }
    };
    $mapper = new \Magento\Framework\ObjectManager\Config\Mapper\Dom(
        new \Magento\Framework\Data\Argument\Interpreter\DataObject(new \Magento\Framework\Stdlib\BooleanUtils())
    );
    foreach ([
        ['NewService', '', ['instance' => 'NewService', 'sortOrder' => '15'], null],
        ['', ' sortOrder="20"', ['instance' => 'OldService', 'sortOrder' => '20'], null],
        ['NewService', ' sortOrder="20"', ['instance' => 'NewService', 'sortOrder' => '20'], 'new'],
    ] as [$next, $metadata, $expected, $owner]) {
        $old = $document('OldService', ' sortOrder="15"');
        $new = $document($next, $metadata);
        foreach (['old' => $old, 'new' => $new] as $id => $dom) {
            DiUsageManifest::annotate($dom->getElementsByTagName('argument')->item(0), $id);
        }
        $merged = new \Magento\Framework\Config\Dom($old->saveXML(), $validation,
            ['/config/type' => 'name', '/config/type/arguments/argument' => 'name'], 'xsi:type');
        $merged->merge($new->saveXML());
        $result = $mapper->convert($merged->getDom());
        $origins = DiUsageManifest::origins($merged->getDom(), $result, ['old' => ['id' => 'old'], 'new' => ['id' => 'new']]);
        verify($result['Probe']['arguments']['service'] === $expected, 'native partial argument merge');
        verify(($origins['arguments']['Probe']['service']['origin']['id'] ?? null) === $owner, 'provenance across partial overrides');
    }
}

$mode = $argv[2] ?? 'proof';
$collector = $mode !== 'proof';
$usage = [
    'eligible' => ['virtual-types' => ['alias' => true, 'base' => true, 'mixed' => true],
        'arguments' => ['alias-label' => true, 'base-label' => true, 'options' => true, 'nested-tag' => true, 'unused' => true, 'mixed-options' => true]],
    'virtualRoutes' => ['ProbeAlias' => ['ids' => ['alias', 'base'], 'resolved' => Example::class],
        'ProbeMixed' => ['ids' => ['mixed'], 'resolved' => Example::class]],
    'virtual' => ['ProbeAlias' => 'ProbeBase', 'ProbeBase' => Example::class, 'ProbeMixed' => Example::class],
    'names' => ['label' => true, 'options' => true, 'tag' => true, 'unused' => true],
    'arguments' => [
        'ProbeAlias' => ['label' => ['id' => 'alias-label', 'array' => false]],
        'ProbeMixed' => ['options' => ['id' => 'mixed-options', 'array' => true]],
        Example::class => ['label' => ['id' => 'base-label', 'array' => false], 'options' => ['id' => 'options', 'array' => true],
            'unused' => ['id' => 'unused', 'array' => false]],
        Nested::class => ['tag' => ['id' => 'nested-tag', 'array' => false]],
    ],
];
require getenv('MAGELENS_XML_HOOKS') ?: __DIR__ . '/../docker/php/xml-hooks.php';
verifyProvenance();
if ($collector) {
    verify(PreferenceManifest::nativeHooks(), 'verified factory and config bodies');
    foreach (DiUsage::hooks(['frontend' => ['diUsage' => $usage]]) as [$class, $method, $pre, $post]) {
        verify(hook($class, $method, $pre, $post), "register $class::$method");
    }
} else {
    $calls = [];
    $trace = [];
    verify(hook(Developer::class, 'create',
        static function ($factory, array $params) use (&$calls) { $calls[] = [$params[0], [], [], []]; },
        static function ($factory, array $params, $result, ?\Throwable $error) use (&$calls, &$trace) {
            $trace[] = [...array_pop($calls), $error ? 'throws' : get_class($result)];
        }), 'create hook');
    verify(hook(Config::class, 'getInstanceType', null,
        static function ($config, array $params, $result, ?\Throwable $error) use (&$calls) {
            $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3);
            if (!$error && ($caller[1]['line'] ?? null) === 49 && ($caller[2]['class'] ?? null) === Developer::class) {
                $calls[array_key_last($calls)][1] = [$result];
            }
        }), 'type hook');
    verify(hook(Developer::class, '_resolveArguments',
        static function ($factory, array $params) use (&$calls) {
            $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3);
            if (($caller[1]['line'] ?? null) === 61 && ($caller[2]['class'] ?? null) === Developer::class) {
                $calls[array_key_last($calls)][2] = [array_column($params[1], 0), array_keys($params[2] ?? [])];
            }
        }, null), 'argument resolver hook');
    verify(hook(NativeConfig::class, 'getArguments', null,
        static function ($config, array $params, $result, ?\Throwable $error) use (&$calls) {
            $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3);
            if (!$error && ($caller[1]['line'] ?? null) === 27 && ($caller[2]['function'] ?? null) === '_resolveArguments') {
                $calls[array_key_last($calls)][3] = array_keys($result);
            }
        }), 'arguments hook');
}

$config = new Config();
$config->extend([
    'ProbeAlias' => ['type' => 'ProbeBase', 'arguments' => ['label' => 'alias']],
    'ProbeBase' => ['type' => Example::class],
    'ProbeMixed' => ['type' => Example::class, 'arguments' => ['options' => ['local' => true]]],
    Example::class => ['arguments' => ['label' => 'base', 'options' => ['active' => true], 'unused' => 'unused']],
    Nested::class => ['arguments' => ['tag' => 'configured']],
]);
$factory = new Developer($config);
$manager = new ObjectManager($factory, $config);
$factory->setObjectManager($manager);
if ($collector) DiUsage::area('frontend', $factory, $config, $usage);
if ($mode === 'collector-stale') {
    $config->getArguments(Example::class);
    $property = new \ReflectionProperty(NativeConfig::class, '_mergedArguments');
    $cache = $property->getValue($config);
    unset($cache[Example::class]['options']);
    $property->setValue($config, $cache);
    try {
        $manager->create(Example::class);
        throw new \LogicException('Expected missing constructor argument');
    } catch (\BadMethodCallException) {
    }
    try {
        DiUsage::finish();
        throw new \LogicException('Expected stale cached arguments to block publication');
    } catch (\RuntimeException $error) {
        verify(str_contains($error->getMessage(), 'factory DI differs'), 'explicit stale argument failure');
    }
    echo "Rejected missing cached constructor argument\n";
    exit;
}
$config->getInstanceType('ProbeAlias');
$config->getArguments('ProbeAlias');

$shared = $manager->get('ProbeAlias');
verify($shared === $manager->get('ProbeAlias') && $shared->label === 'alias'
    && $shared->options === ['active' => true] && $shared->dependency->tag === 'configured', 'cold and shared');
verify($manager->create('ProbeAlias', ['label' => 'caller'])->label === 'caller', 'call-time override');
verify($manager->create(Example::class)->label === 'base', 'direct concrete path');
verify($manager->get(Derived::class)->label === 'base', 'class inheritance');
verify($manager->get('ProbeMixed')->options === ['active' => true, 'local' => true], 'mixed inherited array');
try {
    $manager->create('ProbeAlias', ['label' => 'throw']);
    throw new \LogicException('Expected failure');
} catch (\DomainException $error) {
    verify($error->getMessage() === 'fixture', 'native exception');
}
if ($collector) {
    verify(DiUsage::finish() === ['virtual-types' => true, 'arguments' => true], 'healthy native hooks');
    $events = array_values((new \ReflectionProperty(Recorder::class, 'events'))->getValue());
    $actual = array_map(static fn($event) => [$event['id'], $event['type'], $event['area'], $event['requested'], $event['hits']], $events);
    $expected = [
        ['nested-tag', 'argument-applied', 'frontend', Nested::class, 1],
        ['alias', 'virtual-type-resolved', 'frontend', 'ProbeAlias', 2],
        ['base', 'virtual-type-resolved', 'frontend', 'ProbeAlias', 2],
        ['alias-label', 'argument-applied', 'frontend', 'ProbeAlias', 1],
        ['options', 'argument-applied', 'frontend', 'ProbeAlias', 2],
        ['base-label', 'argument-applied', 'frontend', Example::class, 1],
        ['options', 'argument-applied', 'frontend', Example::class, 1],
        ['base-label', 'argument-applied', 'frontend', Derived::class, 1],
        ['options', 'argument-applied', 'frontend', Derived::class, 1],
        ['mixed', 'virtual-type-resolved', 'frontend', 'ProbeMixed', 1],
        ['base-label', 'argument-applied', 'frontend', 'ProbeMixed', 1],
    ];
    verify($actual === $expected, 'DI usage evidence differs ' . json_encode($actual, JSON_THROW_ON_ERROR));
    foreach ($events as $event) verify(array_keys($event) === ['id', 'type', 'area', 'requested', 'hits'], 'only scalar evidence');
    echo "Native DI usage collector passed with " . count($events) . " aggregate records\n";
    exit;
}
$example = ['label', 'options', 'dependency'];
$expected = [
    [Nested::class, [Nested::class], [['tag'], []], ['tag'], Nested::class],
    ['ProbeAlias', [Example::class], [$example, []], ['label', 'options', 'unused'], Example::class],
    ['ProbeAlias', [Example::class], [$example, ['label']], ['label', 'options', 'unused'], Example::class],
    [Example::class, [Example::class], [$example, []], ['label', 'options', 'unused'], Example::class],
    [Derived::class, [Derived::class], [$example, []], ['label', 'options', 'unused'], Derived::class],
    ['ProbeMixed', [Example::class], [$example, []], ['label', 'options', 'unused'], Example::class],
    ['ProbeAlias', [Example::class], [$example, ['label']], ['label', 'options', 'unused'], 'throws'],
];
verify(!$calls && $trace === $expected, 'Native DI call trace differs ' . json_encode($trace, JSON_THROW_ON_ERROR));
echo json_encode(['php' => PHP_VERSION, 'opentelemetry' => phpversion('opentelemetry'), 'calls' => count($trace)], JSON_THROW_ON_ERROR), PHP_EOL;
