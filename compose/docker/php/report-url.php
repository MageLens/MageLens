<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);

function coverageReportUrl(string $base): string
{
    $parts = parse_url($base);
    if ($parts === false || !in_array($parts['scheme'] ?? '', ['http', 'https'], true)
        || empty($parts['host']) || isset($parts['query']) || isset($parts['fragment'])
        || isset($parts['user']) || isset($parts['pass']) || preg_match('/[\x00-\x20\x7f]/', $base)) {
        throw new RuntimeException('Magento web base URL must be an absolute HTTP(S) URL.');
    }
    return rtrim($base, '/') . '/media/coverage/index.html';
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') !== __FILE__) return;

require '/var/www/html/app/bootstrap.php';
$om = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$store = $om->get(Magento\Store\Model\StoreManagerInterface::class)->getDefaultStoreView();
if (!$store) throw new RuntimeException('No default storefront is configured.');
// WEB omits store codes and index.php; local media must not use a remote media CDN.
$secure = $store->isFrontUrlSecure();
echo coverageReportUrl($store->getBaseUrl(Magento\Framework\UrlInterface::URL_TYPE_WEB, $secure)), "\n";
