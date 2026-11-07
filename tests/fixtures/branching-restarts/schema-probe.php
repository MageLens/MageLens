<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
require '/var/www/html/app/bootstrap.php';
$om = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$db = $om->get(Magento\Framework\App\ResourceConnection::class)->getConnection();
header('Content-Type: application/json');
echo json_encode(['schema'=>$db->fetchOne('SELECT DATABASE()'),'pid'=>getmypid(),
    'persistent'=>$db->getConnection()->getAttribute(PDO::ATTR_PERSISTENT)], JSON_THROW_ON_ERROR);
