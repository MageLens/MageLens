<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

use Laminas\Permissions\Acl\Role\GenericRole;
use MageLens\XmlCoverage\{AdminNavigationFamily, LayoutRuntimeHooks, Recorder};
use Magento\Framework\Acl;
use Magento\Framework\Acl\{AclResource\Provider, AclResource\ProviderInterface, AclResource\TreeBuilder,
    AclResourceFactory, Builder, Loader\ResourceLoader, Role\CurrentRoleContext};
use Magento\Framework\App\{Bootstrap, State};
use Magento\Framework\Authorization\Policy\Acl as AclPolicy;
use Magento\Framework\Interception\{DefinitionInterface, Interceptor, InterceptorInterface, PluginListInterface};

require '/var/www/html/app/bootstrap.php';
$hooks = dirname(getenv('MAGELENS_XML_HOOKS') ?: __DIR__ . '/../docker/php/xml-hooks.php');
require $hooks . '/xml-hooks.php';
require $hooks . '/xml-family-admin-navigation.php';

$om = Bootstrap::create(BP, $_SERVER)->getObjectManager();
$resource = 'MageLens_AdminNavigation::browse';
$parent = 'Application_Blog::manage';
$denied = 'Magento_Backend::dashboard';
$path = 'app/code/MageLens/AdminNavigation/etc/acl.xml';
$bytes = file_get_contents(BP . '/' . $path);
$files = [$path => ['family' => 'acl', 'sourceHash' => hash('sha256', $bytes),
    'declarations' => AdminNavigationFamily::declarations($path, $bytes)]];
[$targets] = AdminNavigationFamily::prepare($om, $files);
$id = $targets['acl'][$resource]['id'] ?? throw new RuntimeException('Missing original ACL binding');
$collect = !in_array('--without-collector', $argv, true);
if ($collect) {
    (new ReflectionProperty(Recorder::class, 'manifest'))->setValue(null, ['familyContracts' => [$id => ['acl-check']]]);
    foreach (AdminNavigationFamily::hooks(['acl' => [$resource => $targets['acl'][$resource]], 'menu' => []]) as [$class, $method, $pre, $post]) {
        if (!LayoutRuntimeHooks::registerWrapped($class, $method, $pre, $post)) {
            throw new RuntimeException('Could not register Admin provenance hook');
        }
    }
}
$om->get(State::class)->setAreaCode('adminhtml');
$native = $om->get(ProviderInterface::class);
$reader = (new ReflectionProperty(Provider::class, '_configReader'))->getValue($native);

$plugin = new class($resource, $parent, $denied) {
    public int $calls = 0;

    public function __construct(private string $resource, private string $parent, private string $denied) {}

    public function afterGetAclResources(Provider $subject, array $resources): array
    {
        $this->calls++;
        $root = array_search('Magento_Backend::admin', array_column($resources, 'id'), true);
        if ($root === false) throw new RuntimeException('Missing native Admin ACL root');
        $nodes = array_column($resources[$root]['children'], null, 'id');
        $children = array_column($nodes[$this->parent]['children'], null, 'id');
        $nodes[$this->denied]['children'][] = $children[$this->resource];
        unset($children[$this->resource]);
        $nodes[$this->parent]['children'] = array_values($children);
        $resources[$root]['children'] = array_values($nodes);
        return $resources;
    }
};
$decorated = new class($reader, new TreeBuilder()) extends Provider implements InterceptorInterface {
    use Interceptor;

    public function addPlugin(PluginListInterface $plugins): void
    {
        $this->subjectType = Provider::class;
        $this->pluginList = $plugins;
    }

    public function getAclResources()
    {
        return $this->___callPlugins('getAclResources', [], $this->pluginList->getNext(Provider::class, 'getAclResources'));
    }
};
$decorated->addPlugin(new class($plugin) implements PluginListInterface {
    public function __construct(private object $plugin) {}
    public function getNext($type, $method, $code = null) { return [DefinitionInterface::LISTENER_AFTER => ['reparent']]; }
    public function getPlugin($type, $code) { return $this->plugin; }
});

$events = new ReflectionProperty(Recorder::class, 'events');
foreach (['unchanged', 'provider-plugin', 'later-mutation'] as $case) {
    $events->setValue(null, []);
    $acl = new Acl();
    $loader = new ResourceLoader($case === 'provider-plugin' ? $decorated : $native, $om->get(AclResourceFactory::class));
    $loader->populateAcl($acl);
    if ($case === 'later-mutation') {
        // Keep the child's immediate parent but change inherited permissions
        // through an ancestor that only the live ACL knows was moved.
        $acl->removeResource($parent);
        $acl->addResource($parent, $denied);
        $acl->addResource($resource, $parent);
        if (!$acl->inheritsResource($resource, $parent, true)) throw new RuntimeException('Mutation changed the immediate parent');
    }
    $acl->addRole(new GenericRole('1'))->addRole(new GenericRole('2'));
    $acl->allow('1', 'Magento_Backend::admin');
    $acl->deny('1', $denied);
    $builder = (new ReflectionClass(Builder::class))->newInstanceWithoutConstructor();
    (new ReflectionProperty(Builder::class, '_acl'))->setValue($builder, $acl);
    $policy = new AclPolicy($builder, new CurrentRoleContext());
    $allowed = $policy->isAllowed('1', $resource);
    $denial = $policy->isAllowed('2', $resource);
    if ($allowed !== ($case === 'unchanged') || $denial !== false) {
        throw new RuntimeException('Unexpected native authorization result for ' . $case);
    }
    $recorded = array_values($events->getValue());
    $expected = !$collect ? [] : ($case === 'unchanged' ? ['allowed' => 1, 'denied' => 1] : ['ambiguous' => 2]);
    if (array_column($recorded, 'hits', 'outcome') !== $expected) {
        throw new RuntimeException('Incorrect ACL provenance outcome for ' . $case);
    }
    if ($collect && $case !== 'unchanged' && !str_contains($recorded[0]['reason'] ?? '', 'ancestry')) {
        throw new RuntimeException('Missing ancestry limitation for ' . $case);
    }
}
if ($plugin->calls !== 1) throw new RuntimeException('The native provider after-plugin must execute exactly once');
echo "Verified native allowed/denied decisions with original ancestry, provider reparenting and a later ancestor mutation.\n";
