<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
$expectedPhpVersion = $argv[3] ?? '';
if (PHP_VERSION !== $expectedPhpVersion) throw new RuntimeException('Expected PHP ' . $expectedPhpVersion . ', got ' . PHP_VERSION);
require '/var/www/html/app/bootstrap.php';
$vendor = $argv[2] === 'mageos' ? 'mage-os' : 'magento';
$framework = (new ReflectionClass(Magento\Framework\App\Bootstrap::class))->getFileName();
if (!str_contains($framework, "/vendor/$vendor/framework/")) throw new RuntimeException('Unexpected platform framework: ' . $framework);
$om = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$admin = Magento\Framework\App\Area::AREA_ADMINHTML;
$om->get(Magento\Framework\App\State::class)->setAreaCode($admin);
$area = $om->get(Magento\Framework\App\AreaList::class)->getArea($admin);
$area->load(Magento\Framework\App\Area::PART_CONFIG);
$area->load(Magento\Framework\App\Area::PART_DESIGN);
$expected = ['hyva' => 'Hyva/default-csp', 'luma' => 'Magento/luma'][$argv[1]];
$design = $om->get(Magento\Framework\View\DesignInterface::class);
$adminTheme = $design->getDesignTheme()->getFullPath();
if ($adminTheme !== 'adminhtml/Magento/backend') {
    throw new RuntimeException('Expected active adminhtml/Magento/backend, got ' . $adminTheme);
}
$factory = $om->get(Magento\Framework\View\Design\Theme\FlyweightFactory::class);
foreach ($om->get(Magento\Store\Model\StoreManagerInterface::class)->getStores() as $store) {
    if (!$store->getIsActive()) continue;
    $theme = $factory->create($design->getConfigurationDesignTheme('frontend', ['store' => $store]), 'frontend');
    if ($theme->getThemePath() !== $expected) throw new RuntimeException('Expected active ' . $expected . ', got ' . $theme->getThemePath());
}
echo 'Verified PHP ', PHP_VERSION, ', storefront theme ', $expected, ' and Admin theme ', $adminTheme, "\n";
