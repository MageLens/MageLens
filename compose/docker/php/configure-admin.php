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
$version = $om->get(\Magento\Framework\App\ProductMetadataInterface::class)->getVersion();
// Match the native "Don't Allow" choice during local-environment provisioning.
$analytics = $om->get(\Magento\AdminAnalytics\Model\ResourceModel\Viewer\Logger::class);
if (!$analytics->checkLogExists()) $analytics->log($version);
$user = $om->create(\Magento\User\Model\User::class)->loadByUsername('application');
if ($user->getId()) $om->get(\Magento\ReleaseNotification\Model\ResourceModel\Viewer\Logger::class)->log((int) $user->getId(), $version);
echo "Configured local Admin onboarding with usage analytics disabled.\n";
