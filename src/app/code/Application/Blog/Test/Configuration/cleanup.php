<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
// Delete only IDs registered by this run, in dependency order. Repeated cleanup
// is safe after partial preparation, and never updates deployment configuration.
// Recover creations interrupted between the database write and ownership flush.
foreach (['websites' => ['store_website', 'website_id'], 'groups' => ['store_group', 'group_id'], 'stores' => ['store', 'store_id']] as $key => [$table, $column]) {
    $owned = $db->fetchCol($db->select()->from($resource->getTableName($table), [$column])->where('name LIKE ?', $old['prefix'] . '%'));
    $old['configuration'][$key] = array_values(array_unique(array_merge($old['configuration'][$key], array_map('intval', $owned))));
}
if ($old['configuration']['stores']) $db->delete($resource->getTableName('core_config_data'), [
    'scope = ?' => 'stores', 'scope_id IN (?)' => $old['configuration']['stores'], 'path = ?' => 'application_blog/display/overridden'
]);
if ($old['configuration']['config']) $db->delete($resource->getTableName('core_config_data'), ['config_id IN (?)' => $old['configuration']['config']]);
foreach ($old['configuration']['groups'] as $id) $db->update($resource->getTableName('store_group'), ['default_store_id' => 0], ['group_id = ?' => $id]);
foreach ($old['configuration']['websites'] as $id) $db->update($resource->getTableName('store_website'), ['default_group_id' => 0], ['website_id = ?' => $id]);
foreach (['stores' => ['store', 'store_id'], 'groups' => ['store_group', 'group_id'], 'websites' => ['store_website', 'website_id']] as $key => [$table, $column]) {
    if ($old['configuration'][$key]) $db->delete($resource->getTableName($table), ["$column IN (?)" => $old['configuration'][$key]]);
}
if (hash_file('sha256', BP . '/app/etc/config.php') !== $old['configuration']['configHash']) throw new RuntimeException('XML coverage changed app/etc/config.php');
$om->get(\Magento\Framework\App\Cache\TypeListInterface::class)->cleanType('config');
