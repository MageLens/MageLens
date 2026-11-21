<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

use Laminas\Permissions\Acl\Role\GenericRole;
use Magento\Backend\Model\Menu\Builder\Command\{Add, Remove, Update};
use Magento\Backend\Model\Menu\Config\{Converter as MenuConverter, Reader as MenuReader, SchemaLocator as MenuSchema};
use Magento\Framework\Acl;
use Magento\Framework\Acl\AclResource\{Config\Converter\Dom as AclConverter, Config\Reader\Filesystem as AclReader, Config\SchemaLocator as AclSchema, TreeBuilder};
use Magento\Framework\Config\{FileResolverInterface, ValidationStateInterface};
use Magento\Framework\Config\Dom\UrnResolver;

require ($argv[1] ?? '/var/www/html/vendor') . '/autoload.php';

function expectAdminNavigation(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$root = $argv[2] ?? realpath(__DIR__ . '/..');
$app = $argv[2] ?? $root . '/src';
$blog = $app . '/app/code/Application/Blog/etc';
$fixture = isset($argv[2]) ? $app . '/app/code/MageLens/AdminNavigation/etc' : __DIR__ . '/fixtures/admin-navigation/module/etc';

$validation = new class implements ValidationStateInterface {
    public function isValidationRequired() { return true; }
};
$resolver = new class($blog, $fixture) implements FileResolverInterface {
    public array $aclOverlay = [];
    public function __construct(private string $blog, private string $fixture) {}
    public function get($filename, $scope = null) {
        $directory = $scope === 'adminhtml' ? '/adminhtml' : '';
        $files = [];
        if ($filename === 'acl.xml') {
            $backend = dirname((new ReflectionClass(MenuReader::class))->getFileName(), 4) . '/etc/acl.xml';
            $files[$backend] = file_get_contents($backend);
        }
        foreach ([$this->blog, $this->fixture] as $module) {
            $path = realpath($module . $directory . '/' . $filename);
            $files[$path] = file_get_contents($path);
        }
        return $filename === 'acl.xml' ? $files + $this->aclOverlay : $files;
    }
};
$urn = new UrnResolver();
$aclReader = new AclReader($resolver, new AclConverter(), new AclSchema($urn), $validation);
$tree = (new TreeBuilder())->build($aclReader->read()['config']['acl']['resources']);
$acl = new Acl();
$load = static function (array $nodes, ?string $parent) use ($acl, &$load): void {
    foreach ($nodes as $node) {
        $acl->addResource($node['id'], $parent);
        $load($node['children'], $node['id']);
    }
};
$load($tree, null);
$acl->addRole(new GenericRole('editor'))->addRole(new GenericRole('reader'));
$acl->allow('editor', 'Application_Blog::manage');
$resource = 'MageLens_AdminNavigation::browse';
expectAdminNavigation($acl->inheritsResource($resource, 'Application_Blog::manage', true), 'Native ACL did not retain the Blog parent');
expectAdminNavigation($acl->isAllowed('editor', $resource), 'Parent permission did not allow access to the child');
expectAdminNavigation(!$acl->isAllowed('reader', $resource), 'Reader unexpectedly has child access');
expectAdminNavigation($acl->isAllowed('editor', 'Application_Blog::manage'), 'Editor cannot access the Blog controller resource');
expectAdminNavigation(!$acl->isAllowed('reader', 'Application_Blog::manage'), 'Reader can access the Blog controller resource');

$moduleReader = new class extends \Magento\Framework\Module\Dir\Reader {
    public function __construct() {}
    public function getModuleDir($type, $moduleName)
    {
        return dirname((new ReflectionClass(MenuReader::class))->getFileName(), 4) . '/etc';
    }
};
$menuReader = new MenuReader($resolver, new MenuConverter(), new MenuSchema($moduleReader), $validation);
$chains = [];
foreach ($menuReader->read('adminhtml') as $command) {
    $class = match ($command['type']) {
        'add' => Add::class,
        'update' => Update::class,
        'remove' => Remove::class,
    };
    $item = new $class($command);
    $id = $item->getId();
    if (isset($chains[$id])) {
        $chains[$id]->chain($item);
    } else {
        $chains[$id] = $item;
    }
}
foreach (['posts', 'categories'] as $section) {
    $item = $chains['MageLens_AdminNavigation::inherited_' . $section]->execute();
    expectAdminNavigation(!isset($item['removed']), 'Native command unexpectedly removed a sibling');
    expectAdminNavigation($item['resource'] === $resource, 'Sibling ACL resource did not match');
    expectAdminNavigation($item['action'] === "application_blog/manage/index/section/$section", 'Sibling action did not match');
}
expectAdminNavigation($chains['MageLens_AdminNavigation::removed']->execute()['removed'] === true, 'Remove command did not suppress its item');

echo "Native ACL and menu command proof passed.\n";
