<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

use Magento\Framework\App\Cache\StateInterface;
use Magento\Framework\App\RequestInterface;
use Magento\Framework\App\Response\Http;

class LayoutPageCache
{
    public function __construct(private StateInterface $state, private RequestInterface $request, private Http $response)
    {
    }

    private function isFixture(): bool
    {
        return preg_match('~^/coverageprobe/cachepage(?:/index)?/?$~', $this->request->getPathInfo()) === 1;
    }

    public static function nonce(RequestInterface $request): string
    {
        $value = (string)$request->getParam('probe');
        if (!preg_match('/^[a-z0-9-]{1,64}$/', $value)) throw new \InvalidArgumentException('Invalid layout cache fixture identifier');
        return $value;
    }

    public function beforeAroundDispatch($subject, $controller, \Closure $proceed, RequestInterface $request): void
    {
        if ($this->isFixture()) $this->state->setEnabled('full_page', true);
    }

    public function afterLoad($subject, $result)
    {
        if ($this->isFixture()) {
            $response = $result instanceof Http ? $result : $this->response;
            $response->setHeader('X-MageLens-Fixture-Cache', $result === false ? 'miss' : 'hit', true);
        }
        return $result;
    }
}
