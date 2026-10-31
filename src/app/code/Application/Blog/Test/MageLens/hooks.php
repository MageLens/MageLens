<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
// Run-owned fixtures only. Ordinary articles, categories and users are retained.
$action = $argv[1] ?? '';
if ($action === 'before' || $action === 'cleanup') {
    passthru('bash /application/docker/php/cypress-patches.sh ' . ($action === 'before' ? 'apply' : 'revert'), $status);
    if ($status !== 0) exit($status);
    if ($action === 'before') exit;
}
require '/var/www/html/app/bootstrap.php';
$bootstrap = \Magento\Framework\App\Bootstrap::create(BP, $_SERVER);
$om = $bootstrap->getObjectManager();
$om->get(\Magento\Framework\App\State::class)->setAreaCode('adminhtml');
$resource = $om->get(\Magento\Framework\App\ResourceConnection::class);
$db = $resource->getConnection();
$statePath = BP . '/var/blog-coverage-fixtures.json';
$action = $argv[1] ?? '';
if (!in_array($action, ['prepare', 'cleanup'], true)) throw new RuntimeException('Use prepare or cleanup.');
if (is_file($statePath)) {
    $old = json_decode(file_get_contents($statePath), true, 512, JSON_THROW_ON_ERROR);
    if (!preg_match('/^coverage-[a-f0-9]{32}-$/D', $old['prefix'] ?? '')) throw new RuntimeException('Invalid fixture cleanup identity.');
    $prefix = $old['prefix'];
    $posts = $db->fetchCol($db->select()->from($resource->getTableName('application_blog_post'), ['post_id'])->where('slug LIKE ?', $prefix . '%'));
    foreach ($posts as $id) $om->get(\Application\Blog\Model\Posts::class)->delete((int) $id);
    $db->delete($resource->getTableName('application_blog_category'), ['slug LIKE ?' => $prefix . '%']);
    $user = $om->create(\Magento\User\Model\User::class)->loadByUsername($old['readerUser']);
    if ($user->getId()) $user->delete();
    $role = $om->create(\Magento\Authorization\Model\Role::class)->load($prefix . 'reader', 'role_name');
    if ($role->getId()) $role->delete();
    unlink($statePath);
}
if ($action === 'cleanup') { echo "Removed run-owned Blog fixtures.\n"; exit; }
$run = json_decode(file_get_contents('/coverage/run.json'), true, 512, JSON_THROW_ON_ERROR);
if (!preg_match('/^[a-f0-9]{32}$/D', $run['id'])) throw new RuntimeException('Invalid run ID.');
$fixture = ['run' => $run['id'], 'prefix' => 'coverage-' . $run['id'] . '-', 'query' => 'Run-' . $run['id'],
    'readerUser' => 'reader_' . $run['id'], 'readerPassword' => 'Reader9!' . bin2hex(random_bytes(16))];
$fixture['warmupPaths'] = ['/' . $om->get(\Magento\Backend\App\Area\FrontNameResolver::class)->getFrontName() . '/'];
$store = $om->get(\Magento\Store\Model\StoreManagerInterface::class)->getDefaultStoreView();
$themeKey = $om->get(\Magento\Framework\View\DesignInterface::class)->getConfigurationDesignTheme('frontend', ['store' => $store]);
$theme = $om->get(\Magento\Framework\View\Design\Theme\FlyweightFactory::class)->create($themeKey, 'frontend');
$fixture['themePaths'] = [];
while ($theme) {
    $fixture['themePaths'][] = $theme->getThemePath();
    $theme = $theme->getParentTheme();
}
$persist = static function () use (&$fixture, $statePath): void {
    if (file_put_contents($statePath . '.tmp', json_encode($fixture, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR)) === false) {
        throw new RuntimeException('Cannot persist fixture ownership.');
    }
    chmod($statePath . '.tmp', 0600);
    if (!rename($statePath . '.tmp', $statePath)) throw new RuntimeException('Cannot publish fixture ownership.');
};
$persist();
$categories = $om->get(\Application\Blog\Model\Categories::class);
$posts = $om->get(\Application\Blog\Model\Posts::class);
$fixture['category'] = $categories->save(['name' => $fixture['query'] . ' Engineering', 'slug' => $fixture['prefix'] . 'engineering', 'is_active' => 1]);
$fixture['otherCategory'] = $categories->save(['name' => $fixture['query'] . ' People', 'slug' => $fixture['prefix'] . 'people', 'is_active' => 1]);
$fixture['inactiveCategory'] = $categories->save(['name' => $fixture['query'] . ' Private', 'slug' => $fixture['prefix'] . 'private', 'is_active' => 0]);
for ($i = 1; $i <= 11; $i++) {
    $posts->save(['title' => $fixture['query'] . ' Article ' . $i, 'slug' => $fixture['prefix'] . 'article-' . $i,
        'author' => 'Test editor', 'excerpt' => 'Searchable article summary ' . $i,
        'body' => "Article $i body.\nA second paragraph with <script>alert('unsafe')</script> as plain text.",
        'category_id' => $i === 11 ? $fixture['inactiveCategory'] : ($i <= 6 ? $fixture['category'] : $fixture['otherCategory']),
        'status' => $i === 9 ? 'draft' : 'published', 'published_at' => $i === 10 ? '2099-01-01 12:00:00' : '2025-01-01 12:00:00']);
}
$user = $om->create(\Magento\User\Model\User::class)->loadByUsername($fixture['readerUser']);
if ($user->getId()) throw new RuntimeException('Fixture user already exists. Refusing to replace it.');
$role = $om->create(\Magento\Authorization\Model\Role::class)->setName($fixture['prefix'] . 'reader')->setRoleType('G')->setParentId(0)->save();
$fixture['roleId'] = (int) $role->getId();
$persist();
$om->create(\Magento\Authorization\Model\Rules::class)->setRoleId($role->getId())->setResources(['Magento_Backend::dashboard'])->saveRel();
$user->setData(['username' => $fixture['readerUser'], 'firstname' => 'Coverage', 'lastname' => 'Reader',
    'email' => $fixture['readerUser'] . '@example.test', 'password' => $fixture['readerPassword'], 'is_active' => 1])->setRoleId($role->getId())->save();
$om->get(\Magento\ReleaseNotification\Model\ResourceModel\Viewer\Logger::class)->log((int) $user->getId(), $om->get(\Magento\Framework\App\ProductMetadataInterface::class)->getVersion());
$persist();
echo json_encode($fixture, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR), "\n";
