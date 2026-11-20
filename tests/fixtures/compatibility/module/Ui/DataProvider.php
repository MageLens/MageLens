<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Ui;

class DataProvider extends \Magento\Ui\DataProvider\AbstractDataProvider
{
    public function getData(): array
    {
        return ['items' => [], 'totalRecords' => 0];
    }
}
