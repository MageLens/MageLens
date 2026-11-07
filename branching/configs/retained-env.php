<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
$environment = require '/branching-control/original-env.php';
$schema = trim(file_get_contents('/branching-control/active-schema'));
$allowed = json_decode(file_get_contents('/branching-control/schemas.json'), true, 512, JSON_THROW_ON_ERROR);
if (!in_array($schema, $allowed, true)) {
    throw new RuntimeException('Unowned branching schema');
}
$environment['db']['connection']['default']['dbname'] = $schema;
return $environment;
