<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

use Magento\Framework\App\Request\Http;
use Magento\Framework\App\Route\Config;

class RouteMetadataPlugin
{
    public function __construct(private readonly Http $request)
    {
    }

    public function afterGetRouteByFrontName(Config $config, $route, $frontName)
    {
        return $frontName === 'catalogue' && $this->request->getQuery('rewrite') === '1' ? '0123' : $route;
    }
}
