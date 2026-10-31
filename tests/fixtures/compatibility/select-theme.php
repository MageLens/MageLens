<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
require '/var/www/html/app/bootstrap.php';
$om = \Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$om->get(\Magento\Framework\App\State::class)->setAreaCode('adminhtml');
$themePath = $argv[1];
$om->get(\Magento\Theme\Model\Theme\Registration::class)->register();
$theme = $om->create(\Magento\Theme\Model\ResourceModel\Theme\Collection::class)->addFieldToFilter('area', 'frontend')->addFieldToFilter('theme_path', $themePath)->getFirstItem();
if (!$theme->getId()) throw new RuntimeException('Theme was not registered: ' . $themePath);
$om->get(\Magento\Framework\App\Config\Storage\WriterInterface::class)->save('design/theme/theme_id', $theme->getId());
echo 'Selected theme ' . $themePath . "\n";
