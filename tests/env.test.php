<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
require dirname(__DIR__) . '/docker/php/configure-env.php';

function check(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}
putenv('APPLICATION_DOMAIN=shop.test');
putenv('APPLICATION_HTTPS_PORT=8443');
$fragment = require dirname(__DIR__) . '/docker/php/env.php.sample';
$original = [
    'crypt' => ['key' => 'preserve-key'], 'db' => ['connection' => ['default' => ['password' => 'preserve-password']]],
    'MAGE_MODE' => 'production', 'cache_types' => ['config' => 1, 'full_page' => 1],
    'system' => ['default' => ['design' => ['theme' => ['theme_id' => 17]]],
        'stores' => ['french' => ['design' => ['theme' => ['theme_id' => 18]], 'dev' => ['template' => ['minify_html' => 1]]]]],
];
$scopes = ['websites' => ['base'], 'stores' => ['default']];
$updated = coverageEnvironment($original, $fragment, $scopes);
check($updated['crypt'] === $original['crypt'] && $updated['db'] === $original['db'], 'Credentials changed');
check($updated['MAGE_MODE'] === 'developer', 'Developer mode missing');
check($updated['cache_types'] === ['config' => 1, 'full_page' => 0, 'block_html' => 0], 'Cache settings incorrect');
check($updated['system']['default']['design'] === $original['system']['default']['design'], 'Default theme changed');
check($updated['system']['stores']['french']['design'] === $original['system']['stores']['french']['design'], 'Store theme changed');
foreach ([$updated['system']['default'], $updated['system']['websites']['base'],
    $updated['system']['stores']['default'], $updated['system']['stores']['french']] as $scope) {
    check($scope['dev']['template']['minify_html'] === 0, 'Scoped HTML minification still enabled');
    check($scope['dev']['js']['minify_files'] === 0 && $scope['dev']['js']['enable_js_bundling'] === 0, 'JS transformed');
    check($scope['web']['secure']['base_url'] === 'https://shop.test:8443/', 'Incorrect scoped URL');
}
check(coverageEnvironment($updated, $fragment, $scopes) === $updated, 'Merge is not idempotent');
echo "PASS: explicit coverage settings, scoped overrides, credentials and theme preservation, repeat merge.\n";
