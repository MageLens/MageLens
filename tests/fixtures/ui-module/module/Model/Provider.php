<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

namespace MageLens\UiProbe\Model;

use Magento\Framework\Api\Filter;
use Magento\Ui\DataProvider\AbstractDataProvider;

class Provider extends AbstractDataProvider
{
    private array $calls = [];
    private ?string $direction = null;

    public function __construct(
        $name,
        $primaryFieldName,
        $requestFieldName,
        private ListingMeta $modifier,
        array $meta = [],
        array $data = []
    ) {
        parent::__construct($name, $primaryFieldName, $requestFieldName, $meta, $data);
    }

    public function getMeta(): array
    {
        $this->calls[] = 'meta';
        if ($this->getName() !== 'probe_data_source') {
            return parent::getMeta();
        }
        return $this->modifier->modifyMeta(parent::getMeta());
    }

    public function getData(): array
    {
        $this->calls[] = 'data';
        if ($this->getName() === 'probe_provider_catches') {
            throw new \RuntimeException('Parent provider failed');
        }
        if ($this->getName() === 'probe_form_data_source') {
            return ['' => ['untouched' => 'Fixture value']];
        }
        $items = [
            ['id' => 1, 'untouched' => 'First row', 'equal' => 'First value', 'replaced' => 'First replacement'],
            ['id' => 2, 'untouched' => 'Second row', 'equal' => 'Second value', 'replaced' => 'Second replacement'],
        ];
        if ($this->direction === 'DESC') {
            $items = array_reverse($items);
        }
        return ['totalRecords' => count($items), 'items' => $items];
    }

    public function addFilter(Filter $filter): void
    {
        $this->calls[] = 'filter';
    }

    public function addOrder($field, $direction): void
    {
        $this->calls[] = 'sort';
        $this->direction = $direction;
    }

    public function setLimit($offset, $size): void
    {
        $this->calls[] = 'page';
    }

    public function calls(): array
    {
        return $this->calls;
    }
}
