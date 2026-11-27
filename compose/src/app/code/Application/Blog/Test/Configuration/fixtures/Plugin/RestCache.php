<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

namespace Application\Blog\Plugin;

use Application\Blog\Model\ApiAreaProbe;
use Magento\Webapi\Controller\Rest\SynchronousRequestProcessor;

final class RestCache
{
    private ?ApiAreaProbe $cachedService = null;

    public function aroundVariant(ApiAreaProbe $subject, callable $proceed, string $scenario): array
    {
        if ($scenario !== 'cached') return $proceed($scenario);
        $this->cachedService = $subject;
        return ['cached-response'];
    }

    public function afterProcess(SynchronousRequestProcessor $subject, mixed $result): mixed
    {
        if ($this->cachedService !== null) {
            $service = $this->cachedService;
            $this->cachedService = null;
            if ($service->variant('unrelated') !== ['unrelated-call']) {
                throw new \RuntimeException('The unrelated call did not run the original service body');
            }
        }
        return $result;
    }
}
