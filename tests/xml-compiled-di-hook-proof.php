<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\ProductionProof;

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
function compile(string $chain, string $area): array
{
    $config = new Config();
    $config->extend([
        'preferences' => [First::class => Service::class, Second::class => Service::class, Chain::class => $chain,
            AreaChoice::class => Service::class, VirtualChoice::class => 'ProbeVirtualA', Broken::class => ThrowingService::class],
        'ProbeVirtualA' => ['type' => 'ProbeVirtualB'],
        'ProbeVirtualB' => ['type' => Service::class],
    ]);
    $factory = new Developer($config);
    $manager = new ObjectManager($factory, $config);
    $factory->setObjectManager($manager);
    $classes = new ClassReaderDecorator(new ClassReader());
    $definitions = new Collection();
    foreach ([Service::class, FrontendService::class, Consumer::class, ThrowingService::class, CallsObjectManager::class] as $type) {
        $definitions->addDefinition($type, $classes->getConstructor($type));
    }
    $reader = new Reader($config, new AreaLoader(), new ArgumentsResolverFactory($manager), $classes, new Type());
    return (new PreferencesResolving())->modify($reader->generateCachePerScope($definitions, $area));
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

$global = compile(First::class, 'global');
$alternate = compile(Second::class, 'global');
check($global === $alternate && $global['preferences'][Chain::class] === Service::class,
    'distinct original chains must be indistinguishable in compiled metadata');
check($global['arguments'][Consumer::class]['dependency'] === ['_i_' => Service::class]
    && $global['instanceTypes']['ProbeVirtualA'] === Service::class, 'compiled descriptor and virtual chain');
$config = new InterceptingConfig($global);
$shared = [];
$factory = new CompiledFactory($config, $shared);
$manager = new ObjectManager($factory, $config, $shared);
$nativeManager = $manager;
CallsObjectManager::$manager = $manager;
$factory->setObjectManager($manager);

$config->getPreference(First::class);
check($manager->get(First::class) === $manager->get(Second::class) && $manager->get(Chain::class) === $manager->get(Service::class),
    'two bindings with a shared object and a direct request');
check($manager->create(First::class) !== $manager->get(First::class), 'successful create and get');
check($manager->get(VirtualChoice::class) instanceof Service, 'terminal virtual alias');
$before = count($lookups);
$consumer = $manager->create(Consumer::class);
check($consumer->dependency === $manager->get(Service::class) && count($lookups) === $before + 2,
    'compiled constructor injection skips Object Manager preference lookup');
$manager->create(CallsObjectManager::class, ['fixture' => true]);
$warm = $manager->get(AreaChoice::class);
$manager->configure(compile(First::class, 'frontend'));
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
echo json_encode(['php' => PHP_VERSION, 'otel' => phpversion('opentelemetry'), 'lookups' => count($lookups),
    'successfulBindingResolutions' => count($resolutions),
    'chainsProduceIdenticalMetadata' => true, 'compiledInjectionBypassesPreferenceLookup' => true,
    'sharedAndAreaOverride' => true, 'throwingConstructor' => true], JSON_THROW_ON_ERROR), PHP_EOL;
