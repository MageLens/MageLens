<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);

$socket = @fsockopen('unix:///sock/phpfpm.sock', -1, $number, $message, 2);
if ($socket === false) {
    fwrite(STDERR, "Cannot connect to PHP-FPM at /sock/phpfpm.sock: $message ($number)\n");
    exit(1);
}
fclose($socket);
