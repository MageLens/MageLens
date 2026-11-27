<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);

function project(): array
{
    return json_decode(file_get_contents('/application/project.json'), true, flags: JSON_THROW_ON_ERROR);
}

if (realpath($_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    require '/var/www/html/app/bootstrap.php';
    $configured = is_file(BP . '/app/etc/config.php') ? require BP . '/app/etc/config.php' : [];
    $roots = project()['roots'];
    $registrar = new \Magento\Framework\Component\ComponentRegistrar;
    foreach ($registrar->getPaths(\Magento\Framework\Component\ComponentRegistrar::MODULE) as $name => $directory) {
        foreach ($roots as $root) {
            if (str_starts_with($directory, BP . '/' . $root . '/') && !array_key_exists($name, $configured['modules'] ?? [])) {
                echo $name, "\n";
                break;
            }
        }
    }
}
