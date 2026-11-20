<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

namespace MageLens\UiProbe\Model;

final class InheritedProvider extends Provider
{
    public function getData(): array
    {
        try {
            parent::getData();
        } catch (\RuntimeException $error) {
            if ($this->getName() !== 'probe_provider_catches' || $error->getMessage() !== 'Parent provider failed') throw $error;
            return ['totalRecords' => 0, 'items' => []];
        }
        throw new \RuntimeException('Configured override failed');
    }
}
