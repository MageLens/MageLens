<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
// Executed in the normal Blog fixture lifecycle, only for the isolated XML fixture.
$fixture['configuration'] = ['websites' => [], 'groups' => [], 'stores' => [], 'config' => [],
    'configHash' => hash_file('sha256', BP . '/app/etc/config.php')];
$persist();
foreach (['journal_website' => ['journal_store', 'journal_inherited_store', 'Journal_Mixed'], 'journal_other_website' => ['journal_other_store']] as $code => $codes) {
    if ($db->fetchOne($db->select()->from($resource->getTableName('store_website'), ['website_id'])->where('code = ?', $code))) throw new RuntimeException('XML fixture scope already exists');
    $website = $om->create(\Magento\Store\Model\Website::class)->setCode($code)->setName($fixture['prefix'] . $code)->save();
    $fixture['configuration']['websites'][] = (int) $website->getId(); $persist();
    $group = $om->create(\Magento\Store\Model\Group::class)->setWebsiteId($website->getId())->setCode($code . '_group')->setName($fixture['prefix'] . $code)->setRootCategoryId(2)->save();
    $fixture['configuration']['groups'][] = (int) $group->getId(); $persist();
    foreach ($codes as $storeCode) {
        $store = $om->create(\Magento\Store\Model\Store::class)->setCode($storeCode)->setName($fixture['prefix'] . $storeCode)
            ->setWebsiteId($website->getId())->setGroupId($group->getId())->setIsActive(1)->save();
        $fixture['configuration']['stores'][] = (int) $store->getId(); $persist();
        if ($storeCode === $codes[0]) $group->setDefaultStoreId($store->getId())->save();
        if ($storeCode === 'journal_other_store') {
            // Equal-valued XML/database overrides must still mask XML ownership.
            $row = ['scope' => 'stores', 'scope_id' => (int) $store->getId(), 'path' => 'application_blog/display/overridden', 'value' => 'Default editorial notice'];
            $db->insert($resource->getTableName('core_config_data'), $row);
            $fixture['configuration']['config'][] = (int) $db->lastInsertId($resource->getTableName('core_config_data')); $persist();
        }
    }
    $website->setDefaultGroupId($group->getId())->save();
}
$om->get(\Magento\Store\Model\StoreManagerInterface::class)->reinitStores();
$om->get(\Magento\Framework\App\Cache\TypeListInterface::class)->cleanType('config');
$fixture['warmupPaths'][] = '/blog/index/configuration?case=warmup-only';
$persist();
