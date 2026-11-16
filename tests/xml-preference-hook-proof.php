<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\PreferenceProof;

require $argv[1] . '/autoload.php';
$proof = basename($argv[0]) === 'xml-preference-hook-proof.php';

use Magento\Framework\App\ObjectManager\ConfigLoader;
use Magento\Framework\Config\CacheInterface;
use Magento\Framework\Config\FileResolverInterface;
use Magento\Framework\Config\ValidationStateInterface;
use Magento\Framework\Data\Argument\InterpreterInterface;
use Magento\Framework\Interception\ObjectManager\Config\Developer as Config;
use Magento\Framework\ObjectManager\Config\Config as NativeConfig;
use Magento\Framework\ObjectManager\Config\Mapper\Dom as Mapper;
use Magento\Framework\ObjectManager\Config\Reader\Dom;
use Magento\Framework\ObjectManager\Config\SchemaLocator;
use Magento\Framework\ObjectManager\Factory\Dynamic\Developer;
use Magento\Framework\ObjectManager\ObjectManager;
use Magento\Framework\Serialize\Serializer\Serialize;
use function OpenTelemetry\Instrumentation\hook;

interface First {}
interface Second {}
interface Chained {}
interface Virtual {}
interface Outer {}
interface Failing {}
class Shared implements First, Second, Chained, Virtual {}
class Override extends Shared {}
class SeparateConcrete extends Shared {}
class Nested implements Outer { public function __construct(public First $dependency) {} }
class Throws implements Failing { public function __construct(Second $dependency) { throw new \RuntimeException('proof failure'); } }

function check(bool $ok, string $description): void
{
    if (!$ok) throw new \RuntimeException($description);
}

if ($proof) {
    $frames = $observed = [];
    $sites = [];
    $managerFile = (new \ReflectionClass(ObjectManager::class))->getFileName();
    foreach (['get', 'create'] as $method) {
        $reflection = new \ReflectionMethod(ObjectManager::class, $method);
        $source = file($reflection->getFileName());
        for ($line = $reflection->getStartLine(); $line <= $reflection->getEndLine(); $line++) {
            if (str_contains($source[$line - 1], '->getPreference(')) $sites[$method] = $line;
        }
        check(hook(ObjectManager::class, $method,
            static function ($manager, $args) use (&$frames, $method) {
                $frames[] = [$method, ltrim($args[0], '\\'), null];
            },
            static function ($manager, $args, $result, $error) use (&$frames, &$observed) {
                [$method, $requested, $lookup] = array_pop($frames);
                $observed[] = [$method, $requested, $lookup, $error ? get_class($error) : get_debug_type($result)];
            }), 'Object Manager hook registration');
    }
    check(hook(NativeConfig::class, 'getPreference', null,
        static function ($config, $params, $result, $error, $class) use (&$frames, $sites, $managerFile) {
            $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3);
            if (!$frames || $error || $class !== NativeConfig::class) return;
            $index = array_key_last($frames);
            $method = $frames[$index][0];
            if (($trace[1]['file'] ?? null) !== $managerFile || ($trace[1]['line'] ?? null) !== $sites[$method]
                || ($trace[2]['class'] ?? null) !== ObjectManager::class || ($trace[2]['function'] ?? null) !== $method) return;
            $edges = [];
            $map = $config->getPreferences();
            for ($type = $frames[$index][1]; isset($map[$type]); $type = $map[$type]) $edges[] = [$type, $map[$type]];
            $frames[$index][2] = [$result, $edges];
        }), 'Native config hook registration');
}

$resolver = new class implements FileResolverInterface {
    public int $reads = 0;
    public function get($filename, $scope = null)
    {
        $this->reads++;
        $preference = static fn($for, $type) => "<preference for='$for' type='$type'/>";
        $wrap = static fn($xml) => "<config>$xml</config>";
        return match ($scope) {
            'global' => [
                'first-module/etc/di.xml' => $wrap($preference(First::class, Override::class)),
                'second-module/etc/di.xml' => $wrap($preference(First::class, Shared::class)
                    . $preference(Second::class, Shared::class) . $preference(SeparateConcrete::class, Shared::class)
                    . $preference(Chained::class, First::class)
                    . $preference(Virtual::class, 'ProofVirtual') . "<virtualType name='ProofVirtual' type='" . Shared::class . "'/>"
                    . $preference(Outer::class, Nested::class) . $preference(Failing::class, Throws::class)),
            ],
            'frontend' => ['second-module/etc/frontend/di.xml' => $wrap($preference(First::class, Override::class))],
            default => [],
        };
    }
};
$reader = new Dom($resolver, new Mapper(new class implements InterpreterInterface {
    public function evaluate(array $data) { throw new \LogicException('No XML constructor arguments in this proof'); }
}), new class extends SchemaLocator {
    public function getSchema() { return dirname((new \ReflectionClass(SchemaLocator::class))->getFileName()) . '/../etc/config.xsd'; }
}, new class implements ValidationStateInterface {
    public function isValidationRequired() { return true; }
});
$cache = new class implements CacheInterface {
    private array $data = [];
    public function test($id) { return isset($this->data[$id]); }
    public function load($id) { return $this->data[$id] ?? false; }
    public function save($data, $id, array $tags = [], $lifeTime = null) { $this->data[$id] = $data; return true; }
    public function remove($id) { unset($this->data[$id]); return true; }
    public function clean($mode = 'all', array $tags = []) { $this->data = []; return true; }
    public function getBackend() { throw new \LogicException(); }
    public function getLowLevelFrontend() { throw new \LogicException(); }
};
$reflection = new \ReflectionClass(ConfigLoader::class);
$loader = $reflection->newInstanceWithoutConstructor();
foreach (['_reader' => $reader, '_cache' => $cache, 'serializer' => new Serialize()] as $key => $value) {
    $reflection->getProperty($key)->setValue($loader, $value);
}

if (!$proof) return;

foreach (['cold', 'warm'] as $pass) {
    $config = new Config();
    $factory = new Developer($config);
    $manager = new ObjectManager($factory, $config);
    $factory->setObjectManager($manager);
    $manager->configure($loader->load('global'));
    $observed = [];
    $one = $manager->get(First::class);
    check($one === $manager->get(Second::class), 'two abstractions must share a single instance');
    check($one === $manager->get(Shared::class), 'direct implementation request must return the same instance');
    check($config->getPreference(First::class) === Shared::class && count($observed) === 3, 'isolated lookup must not produce evidence');
    check($manager->create(First::class) !== $one, 'create must return a fresh instance');
    check($manager->get(Chained::class) === $one, 'preference chain must choose its terminal instance');
    check(get_class($manager->get(Virtual::class)) === Shared::class, 'virtual target must resolve to the underlying class');
    check($manager->create(Outer::class)->dependency === $one, 'developer constructor injection must use Object Manager get');
    try {
        $manager->create(Failing::class);
        throw new \LogicException('Expected constructor failure');
    } catch (\RuntimeException $e) {
        check($e->getMessage() === 'proof failure', 'Original exception must propagate');
    }
    $manager->configure($loader->load('frontend'));
    check(get_class($manager->get(First::class)) === Override::class, 'area override must replace the global mapping');
    check($manager->get(SeparateConcrete::class) === $one, 'A direct concrete request can apply its own binding');
    $expected = [
        ['get', First::class, [Shared::class, [[First::class, Shared::class]]], Shared::class],
        ['get', Second::class, [Shared::class, [[Second::class, Shared::class]]], Shared::class],
        ['get', Shared::class, [Shared::class, []], Shared::class],
        ['create', First::class, [Shared::class, [[First::class, Shared::class]]], Shared::class],
        ['get', Chained::class, [Shared::class, [[Chained::class, First::class], [First::class, Shared::class]]], Shared::class],
        ['get', Virtual::class, ['ProofVirtual', [[Virtual::class, 'ProofVirtual']]], Shared::class],
        ['get', First::class, [Shared::class, [[First::class, Shared::class]]], Shared::class],
        ['create', Outer::class, [Nested::class, [[Outer::class, Nested::class]]], Nested::class],
        ['get', Second::class, [Shared::class, [[Second::class, Shared::class]]], Shared::class],
        ['create', Failing::class, [Throws::class, [[Failing::class, Throws::class]]], \RuntimeException::class],
        ['get', First::class, [Override::class, [[First::class, Override::class]]], Override::class],
        ['get', SeparateConcrete::class, [Shared::class, [[SeparateConcrete::class, Shared::class]]], Shared::class],
    ];
    check($observed === $expected, 'Unexpected native hook trace ' . json_encode($observed));
    check(!$frames && $resolver->reads === 2, 'Frames must unwind and warm loading must bypass the reader');
    echo json_encode(['pass' => $pass, 'readerCalls' => $resolver->reads, 'observed' => $observed], JSON_THROW_ON_ERROR), PHP_EOL;
}
