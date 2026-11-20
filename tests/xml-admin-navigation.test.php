<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

use MageLens\XmlCoverage\AdminNavigationFamily;
use Magento\Backend\Model\Menu\Config as MenuConfig;
use Magento\Framework\Acl\AclResource\{Provider, ProviderInterface};

require __DIR__ . '/xml-admin-navigation-native.test.php';
$hooks = getenv('MAGELENS_XML_EVIDENCE') ?: dirname(getenv('MAGELENS_XML_HOOKS') ?: __DIR__ . '/../docker/php/xml-hooks.php');
require $hooks . '/xml-family-admin-navigation.php';
require $hooks . '/xml-data.php';
require $hooks . '/xml-family-evidence.php';

define('BP', $root);
$menu = (new ReflectionClass(MenuConfig::class))->newInstanceWithoutConstructor();
(new ReflectionProperty(MenuConfig::class, '_configReader'))->setValue($menu, $menuReader);
$provider = (new ReflectionClass(Provider::class))->newInstanceWithoutConstructor();
(new ReflectionProperty(Provider::class, '_configReader'))->setValue($provider, $aclReader);
$om = new class($menu, $provider) {
    public function __construct(private MenuConfig $menu, private Provider $provider) {}
    public function get(string $class): object
    {
        return match ($class) {
            MenuConfig::class => $this->menu,
            ProviderInterface::class => $this->provider,
        };
    }
};
$files = [];
foreach ([$blog, $fixture] as $directory) {
    foreach (['acl' => '/acl.xml', 'menu' => '/adminhtml/menu.xml'] as $family => $suffix) {
        $original = realpath($directory . $suffix);
        $source = file_get_contents($original);
        $path = substr($original, strlen(BP) + 1);
        $declarations = AdminNavigationFamily::declarations($path, $source);
        expectAdminNavigation($declarations === AdminNavigationFamily::declarations($path, str_replace("\n", "\r\n", $source)),
            'Original identities and spans changed with line endings');
        $files[$path] = ['path' => $path, 'family' => $family, 'declarations' => $declarations, 'sourceHash' => hash('sha256', $source)];
    }
}
[$targets, $hashes] = AdminNavigationFamily::prepare($om, $files);
foreach ($files as $file) {
    expectAdminNavigation(($hashes[BP . '/' . $file['path']] ?? null) === $file['sourceHash'], 'Wrong native provider fingerprint');
}
$aclFile = realpath($fixture . '/acl.xml');
$menuFile = realpath($fixture . '/adminhtml/menu.xml');
$aclItems = array_column($files[substr($aclFile, strlen(BP) + 1)]['declarations'], null, 'path');
$menuItems = $files[substr($menuFile, strlen(BP) + 1)]['declarations'];
$child = $aclItems['MageLens_AdminNavigation::browse'];
expectAdminNavigation($child['startLine'] === 12 && $child['endLine'] === 12, 'Child resource line moved');
expectAdminNavigation($child['supported'] && $child['binding']['parent'] === 'Application_Blog::manage', 'Child attribution missing its native parent');
expectAdminNavigation($aclItems['MageLens_AdminNavigation::unused']['supported'], 'Unvisited resource was removed from the denominator');
expectAdminNavigation(!$aclItems['Application_Blog::manage']['supported'], 'Structural ACL reference gained declaration ownership');
[$posts, $categories, $removed, $remove] = $menuItems;
expectAdminNavigation($posts['startLine'] === 9 && $posts['endLine'] === 10, 'Posts declaration span is wrong');
expectAdminNavigation($categories['supported'] && $posts['supported'] && $categories['id'] !== $posts['id'], 'Sibling menu IDs were conflated');
expectAdminNavigation($posts['effects'] === ['menu-emitted', 'menu-followed'], 'Menu emission and following are not independent effects');
expectAdminNavigation(!$removed['supported'] && str_contains($removed['reason'], 'remove'), 'Removed item was still eligible');
expectAdminNavigation(!$remove['supported'] && $remove['reason'], 'Remove command must retain explicit limitations');
expectAdminNavigation(!isset($targets['menu']['MageLens_AdminNavigation::removed']), 'Removed menu entry kept its runtime binding');

echo "Admin XML provenance proof passed.\n";
