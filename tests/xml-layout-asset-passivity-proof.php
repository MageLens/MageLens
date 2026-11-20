<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

require '/var/www/html/vendor/autoload.php';
require dirname(getenv('MAGELENS_XML_HOOKS') ?: __DIR__ . '/../docker/php/xml-hooks.php') . '/xml-hooks.php';

use MageLens\XmlCoverage\{LayoutAssetsCoverage, LayoutRuntimeHooks, Recorder};
use Magento\Framework\App\Config\ScopeConfigInterface;
use Magento\Framework\View\Asset\{GroupedCollection, PropertyGroup, PropertyGroupFactory, Remote, RemoteFactory, Repository};
use Magento\Framework\View\Layout\Element;
use Magento\Framework\View\Page\Config;
use Magento\Framework\View\Page\Config\{Renderer, Structure};
use Magento\Framework\View\Page\Config\Generator\Head as Generator;
use Magento\Framework\View\Page\Config\Reader\Head;

class CountingAssetStructure extends Structure
{
    public int $reads = 0;
    public bool $throw = false;

    public function getAssets()
    {
        $this->reads++;
        if ($this->throw) throw new DomainException('asset getter');
        return parent::getAssets();
    }
}

class CountingAssetGroup extends PropertyGroup
{
    public array $reads = [];

    public function getAll()
    {
        $this->reads[] = 'all';
        return parent::getAll();
    }

    public function getProperties()
    {
        $this->reads[] = 'properties';
        return parent::getProperties();
    }

    public function getProperty($name)
    {
        $this->reads[] = $name;
        return parent::getProperty($name);
    }
}

class CountingAssetCollection extends GroupedCollection
{
    public int $reads = 0;

    public function getGroups()
    {
        $this->reads++;
        return parent::getGroups();
    }
}

$enabled = !in_array('--without-collector', $argv, true);
if ($enabled) {
    $collector = new LayoutAssetsCoverage(static fn() => [
        ['asset-reference' => 'reference', 'asset-attribute-rel' => 'rel', 'asset-order' => 'order'],
        ['area' => 'frontend', 'theme' => 'frontend/Magento/luma'],
    ]);
    foreach ($collector->hooks() as [$class, $method, $pre, $post]) {
        if (!LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException("Cannot hook $class::$method");
    }
}

$structure = new CountingAssetStructure();
$structure->addAssets('remove', ['src' => 'remove']);
$structure->removeAssets('remove');
$structure->throw = true;
$removed = $structure->processRemoveAssets() === $structure;
if (!$removed || $structure->reads !== 0) throw new RuntimeException('Inherited asset removal invoked the overridable getter');

function assetProofObject(string $class, array $properties = []): object
{
    $type = new ReflectionClass($class);
    $object = $type->newInstanceWithoutConstructor();
    foreach ($properties as $name => $value) $type->getProperty($name)->setValue($object, $value);
    return $object;
}

$groupFactory = new class extends PropertyGroupFactory {
    public function __construct() {}
    public function create(array $data = []) { return new CountingAssetGroup($data['properties']); }
};
$remoteFactory = new class extends RemoteFactory {
    public function __construct() {}
    public function create(array $data = []) { return new Remote($data['url'], $data['contentType']); }
};
$collection = new CountingAssetCollection($groupFactory);
$repository = assetProofObject(Repository::class, ['remoteFactory' => $remoteFactory]);
$config = assetProofObject(Config::class, ['assetRepo' => $repository, 'pageAssets' => $collection]);
$generator = assetProofObject(Generator::class, ['pageConfig' => $config]);
$generate = new ReflectionMethod(Generator::class, 'processAssets');
try {
    $generate->invoke($generator, $structure);
    throw new RuntimeException('Generation swallowed the native exception');
} catch (DomainException $error) {
    $exception = [$error::class, $error->getMessage()];
}
if ($structure->reads !== 1) throw new RuntimeException('Generation invoked the throwing getter more than once');

$reader = assetProofObject(Head::class);
$schedule = new ReflectionMethod(Head::class, 'processNode');
$xml = '<link src="https://example.test/asset" src_type="url" rel="preconnect" order="7"/>';
$structure->throw = false;
$schedule->invoke($reader, new Element($xml), $structure);
$generated = $generate->invoke($generator, $structure) === $generator;
if (!$generated || $structure->reads !== 2) throw new RuntimeException('Generation changed getter calls or return value');

// The native structure is the positive control for grouped creation and rendering.
$schedule->invoke($reader, new Element($xml), $native = new Structure());
$generate->invoke($generator, $native);
$scope = new class implements ScopeConfigInterface {
    public function getValue($path = null, $scopeType = ScopeConfigInterface::SCOPE_TYPE_DEFAULT, $scopeCode = null) { return false; }
    public function isSetFlag($path, $scopeType = ScopeConfigInterface::SCOPE_TYPE_DEFAULT, $scopeCode = null) { return false; }
};
$renderer = assetProofObject(Renderer::class, ['scopeConfig' => $scope, 'escaper' => new Magento\Framework\Escaper()]);
$group = $collection->getGroups()[0];
$output = (new ReflectionMethod(Renderer::class, 'renderAssetGroup'))->invoke($renderer, $group);
if (!str_contains($output, 'href="https://example.test/asset"') || !str_contains($output, 'rel="preconnect"')) {
    throw new RuntimeException('Native grouped asset output changed');
}
$collection->remove('https://example.test/asset');
if ($collection->reads !== 1) throw new RuntimeException('Collector invoked the grouped collection getter');
if ($enabled) {
    $collector->finish();
    LayoutRuntimeHooks::assertHealthy();
    $events = array_column((new ReflectionProperty(Recorder::class, 'events'))->getValue(), 'type');
    if (!in_array('layout-asset-reference-rendered', $events, true)) throw new RuntimeException('Native grouped asset was not attributed');
}
echo json_encode([$removed, $generated, $exception, $structure->reads, $collection->reads, $group->reads, $output], JSON_THROW_ON_ERROR) . "\n";
