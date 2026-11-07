<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
header('Content-Type: application/json');
echo json_encode(['pid'=>getmypid()], JSON_THROW_ON_ERROR);
fastcgi_finish_request();
usleep(3000000);
file_put_contents('/var/www/html/var/session/p0-drain-probe', 'finished');
