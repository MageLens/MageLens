<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
require dirname(__DIR__) . '/docker/php/configure-theme.php';

function expectThemes(array $registered, array $roots, array $expected, string $scenario): void
{
    $actual = localFrontendThemes($registered, $roots, '/shop');
    if ($actual !== $expected) throw new RuntimeException($scenario . ': ' . json_encode($actual));
    echo 'PASS: ', $scenario, "\n";
}

$roots = ['app/code', 'app/design/frontend', 'app/design/adminhtml'];
$local = ['frontend/Application/coverage' => '/shop/app/design/frontend/Application/coverage'];
$composer = [
    'frontend/Magento/blank' => '/shop/vendor/magento/theme-frontend-blank',
    'frontend/Magento/luma' => '/shop/vendor/magento/theme-frontend-luma',
    'frontend/Commercial/shop' => '/shop/vendor/commercial/theme-shop',
    'adminhtml/Magento/backend' => '/shop/vendor/magento/theme-adminhtml-backend',
];
$archive = [
    'frontend/Magento/blank' => '/shop/app/design/frontend/Magento/blank',
    'frontend/Magento/luma' => '/shop/app/design/frontend/Magento/luma',
    'adminhtml/Magento/backend' => '/shop/app/design/adminhtml/Magento/backend',
];
expectThemes($composer + $local, $roots, ['Application/coverage'], 'Composer themes are not mistaken for local themes');
expectThemes($archive + $local, $roots, ['Application/coverage'], 'bundled archive themes do not prevent custom theme selection');
expectThemes($composer, $roots, [], 'no local theme leaves selection unchanged');
expectThemes($archive, $roots, [], 'core-only source archive has no custom theme');
expectThemes($local, ['app/code'], [], 'themes outside configured source roots are excluded');
expectThemes($local, ['app/design/frontend/Applicatio'], [], 'source root matching respects directory boundaries');
expectThemes(['frontend/Client/shop' => '/shop/app/design/frontend-copy/Client/shop'], $roots, [], 'theme directory matching respects boundaries');
expectThemes(['frontend/Client/shop' => '/other/app/design/frontend/Client/shop'], $roots, [], 'external registrations are not local themes');
expectThemes($local, ['app/design/frontend', 'app/design/frontend/Application'], ['Application/coverage'], 'overlapping roots do not duplicate candidates');
expectThemes($local, ['app/design/frontend/Application/coverage'], ['Application/coverage'], 'a selected theme root remains discoverable');
expectThemes($archive + ['frontend/Magento/custom' => '/shop/app/design/frontend/Magento/custom'], $roots, ['Magento/custom'], 'custom themes under the Magento namespace remain selectable');
expectThemes($local + ['frontend/Client/shop' => '/shop/app/design/frontend/Client/shop'], $roots, ['Application/coverage', 'Client/shop'], 'multiple custom themes remain an explicit choice');

if (!in_array('--magento', $argv, true)) exit;
require '/var/www/html/app/bootstrap.php';
$om = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$om->get(Magento\Framework\App\State::class)->setAreaCode('adminhtml');
$resource = $om->get(Magento\Framework\App\ResourceConnection::class);
$db = $resource->getConnection();
$table = $resource->getTableName('core_config_data');
$path = 'design/theme/theme_id';
$original = $db->fetchAll($db->select()->from($table)->where('path = ?', $path));
$environmentKey = 'CONFIG__DEFAULT__DESIGN__THEME__THEME_ID';
$originalEnvironment = $_ENV[$environmentKey] ?? null;
$writer = $om->get(Magento\Framework\App\Config\Storage\WriterInterface::class);
$reload = static function () use ($om): void {
    $om->get(Magento\Framework\App\Cache\TypeListInterface::class)->cleanType('config');
    $om->get(Magento\Framework\App\Config\ReinitableConfigInterface::class)->reinit();
};
$rows = static fn() => $db->fetchAll($db->select()->from($table, ['scope', 'scope_id', 'path', 'value'])->where('path = ?', $path)->order(['scope', 'scope_id']));
$clear = static function () use ($db, $table, $path, $reload): void {
    $db->delete($table, ['path = ?' => $path]);
    $reload();
};
try {
    $clear();
    configureProjectTheme($om, $roots);
    $selected = $rows();
    $themeId = $db->fetchOne($db->select()->from($resource->getTableName('theme'), ['theme_id'])->where('theme_path = ?', 'Application/coverage')->where('area = ?', 'frontend'));
    if (count($selected) !== 1 || (string) $selected[0]['value'] !== (string) $themeId) {
        throw new RuntimeException('The unconfigured installation did not select the demo theme.');
    }
    configureProjectTheme($om, $roots);
    if ($rows() !== $selected) throw new RuntimeException('A repeated install changed the selected theme.');
    echo "PASS: an unconfigured existing installation selects the real demo theme and reruns preserve it.\n";

    $blankId = $db->fetchOne($db->select()->from($resource->getTableName('theme'), ['theme_id'])->where('theme_path = ?', 'Magento/blank')->where('area = ?', 'frontend'));
    $stores = $om->get(Magento\Store\Model\StoreManagerInterface::class);
    $scopes = [['default', 0], ['websites', array_values($stores->getWebsites())[0]->getId()], ['stores', array_values($stores->getStores())[0]->getId()]];
    foreach ($scopes as [$scope, $id]) {
        $clear();
        $writer->save($path, $blankId, $scope, $id);
        $reload();
        $before = $rows();
        configureProjectTheme($om, $roots);
        if ($rows() !== $before) throw new RuntimeException('Configured theme overwritten at ' . $scope);
        echo 'PASS: preserved explicit ', $scope, " theme without adding a default.\n";
    }

    $clear();
    $_ENV[$environmentKey] = (string) $blankId;
    $reload();
    configureProjectTheme($om, $roots);
    if ($rows()) throw new RuntimeException('Installer wrote a theme over environment configuration.');
    echo "PASS: environment-selected theme is preserved.\n";
} finally {
    if ($originalEnvironment === null) unset($_ENV[$environmentKey]);
    else $_ENV[$environmentKey] = $originalEnvironment;
    $db->delete($table, ['path = ?' => $path]);
    if ($original) $db->insertMultiple($table, $original);
    $reload();
}
