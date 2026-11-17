<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

require '/var/www/html/app/bootstrap.php';
$om = \Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$om->get(\Magento\Framework\App\State::class)->setAreaCode('adminhtml');
$om->get(\Magento\Theme\Model\Theme\Registration::class)->register();
$theme = $om->create(\Magento\Theme\Model\ResourceModel\Theme\Collection::class)
    ->addFieldToFilter('area', 'frontend')->addFieldToFilter('theme_path', 'MageLens/child')->getFirstItem();
if (!$theme->getId() || $theme->getParentTheme()->getThemePath() !== 'MageLens/parent') {
    throw new RuntimeException('The disposable parent and child themes were not registered');
}
$default = $om->get(\Magento\Store\Model\StoreManagerInterface::class)->getDefaultStoreView();
$store = $om->create(\Magento\Store\Model\Store::class)->load('magelens_layout_fixture', 'code');
if ($store->getId() && $store->getName() !== 'MageLens layout fixture') {
    throw new RuntimeException('Refusing to replace an existing store');
}
if (!$store->getId()) {
    $store->setCode('magelens_layout_fixture')->setName('MageLens layout fixture')
        ->setWebsiteId($default->getWebsiteId())->setGroupId($default->getGroupId())->setIsActive(1)->save();
}
$om->get(\Magento\Framework\App\Config\Storage\WriterInterface::class)->save(
    'design/theme/theme_id', (string) $theme->getId(), 'stores', (int) $store->getId()
);
$om->get(\Magento\Framework\App\Cache\TypeListInterface::class)->cleanType('config');
echo "Prepared the disposable layout-provider store and theme ancestry.\n";
