<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

// Persist ownership first, so a failure between saving the role and user can be retried.
$fixture['navigation'] = [
    'user' => 'editor_' . $fixture['run'],
    'password' => 'Editor9!' . bin2hex(random_bytes(16)),
];
$persist();
$editor = $om->create(\Magento\User\Model\User::class)->loadByUsername($fixture['navigation']['user']);
if ($editor->getId()) throw new RuntimeException('Fixture editor already exists. Refusing to replace it.');
$editorRole = $om->create(\Magento\Authorization\Model\Role::class)
    ->setName($fixture['prefix'] . 'editor')->setRoleType('G')->setParentId(0)->save();
// The test's child XML resource receives permission through the Blog parent.
$permissions = ['Application_Blog::manage', 'Magento_Backend::dashboard', 'Magento_Catalog::products'];
$om->create(\Magento\Authorization\Model\Rules::class)->setRoleId($editorRole->getId())
    ->setResources($permissions)->saveRel();
// The role editor writes explicit denies for unchecked resources. The
// native rule loader also denies missing resources for roles with deny rules.
// Leave this disposable role with its explicit allows and let ACL resolve
// the child through the XML hierarchy. Remove the root allow that the
// role editor adds by default so this fixture remains restricted.
$rules = $resource->getTableName('authorization_rule');
$role = ['role_id = ?' => (int) $editorRole->getId()];
if (!$db->delete($rules, $role + ['permission = ?' => 'deny'])) {
    throw new RuntimeException('Cannot establish inherited Admin fixture permission.');
}
$db->delete($rules, $role + ['resource_id = ?' => 'Magento_Backend::admin']);
$allowed = $db->fetchCol($db->select()->from($rules, 'resource_id')->where('role_id = ?', (int) $editorRole->getId()));
sort($allowed);
if ($allowed !== $permissions) {
    throw new RuntimeException('Unexpected direct permission on inherited Admin fixture role.');
}

$editor->setData([
    'username' => $fixture['navigation']['user'],
    'firstname' => 'Coverage',
    'lastname' => 'Editor',
    'email' => $fixture['navigation']['user'] . '@example.test',
    'password' => $fixture['navigation']['password'],
    'is_active' => 1,
])->setRoleId($editorRole->getId())->save();
$om->get(\Magento\ReleaseNotification\Model\ResourceModel\Viewer\Logger::class)
    ->log((int) $editor->getId(), $om->get(\Magento\Framework\App\ProductMetadataInterface::class)->getVersion());
