<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

namespace MageLens\UiProbe\Model;

use Magento\Ui\DataProvider\Modifier\ModifierInterface;

final class ListingMeta implements ModifierInterface
{
    public function modifyData(array $data): array
    {
        return $data;
    }

    public function modifyMeta(array $meta): array
    {
        $meta['probe_columns']['children']['replaced']['arguments']['data']['config']['label'] = 'PHP replacement';
        return $meta;
    }
}
