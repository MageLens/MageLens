<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Index;

use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\App\Request\Http;
use Magento\Framework\Controller\Result\Json;
use Magento\Framework\Controller\Result\JsonFactory;

class Catalogue implements HttpGetActionInterface
{
    public function __construct(private readonly JsonFactory $json, private readonly Http $request)
    {
    }

    public function execute(): Json
    {
        return $this->json->create()->setData(['route' => $this->request->getRouteName()]);
    }
}
