<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Index;
class Save implements \Magento\Framework\App\Action\HttpPostActionInterface
{
    public function __construct(private \Magento\Framework\App\RequestInterface $request, private \Magento\Framework\Controller\Result\JsonFactory $json) {}
    public function execute()
    {
        $value = trim((string) $this->request->getParam('value', ''));
        if ($value === '' || strlen($value) > 32) return $this->json->create()->setHttpResponseCode(400)->setData(['error' => 'Invalid value']);
        return $this->json->create()->setData(['message' => 'Saved ' . $value]);
    }
}
