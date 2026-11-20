<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace Application\Blog\Controller\Index;

use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\Controller\Result\Json;
use Magento\Framework\Controller\Result\JsonFactory;

class Routeprobe implements HttpGetActionInterface
{
    public function __construct(private readonly JsonFactory $json)
    {
    }

    public function execute(): Json
    {
        return $this->json->create()->setData(['winner' => 'blog']);
    }
}
