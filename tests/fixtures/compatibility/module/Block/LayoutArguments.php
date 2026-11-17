<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

namespace MageLens\Compatibility\Block;

use MageLens\Compatibility\Model\LayoutArgumentSource;
use Magento\Framework\View\Element\Template;

class LayoutArguments extends Template
{
    private array $calls = [];

    public function markArgumentAction(string $marker): void
    {
        $this->calls[] = $marker;
    }

    protected function _beforeToHtml()
    {
        $this->setData('replaced', 'from-php');
        return parent::_beforeToHtml();
    }

    public function observedEffects(): array
    {
        $shared = $this->getData('shared_first');
        $firstFresh = $this->getData('fresh_first');
        $secondFresh = $this->getData('fresh_second');
        $urlPath = parse_url((string) $this->getData('route'), PHP_URL_PATH);

        return [
            'string' => $this->getData('literal') === 'fixture-string',
            'number' => $this->getData('amount') === '42',
            'boolean' => $this->getData('flag') === false,
            'null' => $this->hasData('nullable') && $this->getData('nullable') === null,
            'array' => $this->getData('matrix') === [
                'nested' => ['winning' => 'second', 'surviving' => '7'],
                'equal' => 'same',
            ],
            'shared' => $shared instanceof LayoutArgumentSource && $shared === $this->getData('shared_second'),
            'nonshared' => $firstFresh instanceof LayoutArgumentSource && $secondFresh instanceof LayoutArgumentSource
                && $firstFresh !== $secondFresh && $firstFresh !== $shared,
            'options' => $this->getData('options') === [['value' => 'fixture-option', 'label' => 'Fixture label']],
            'helper' => $this->getData('helper') === 'alpha:beta',
            'url' => is_string($urlPath) && str_ends_with($urlPath, '/coverageprobe/handle/index/variant/selected/'),
            'updater' => $this->getData('updatable') === [['value' => 'fixture-option', 'label' => 'Fixture label updated']],
            'text-updater' => $this->getData('text_with_updater') === 'fixture',
            'translation' => $this->getData('translated') === 'MageLens translated marker'
                && $this->getData('untranslated') === 'MageLens layout translation marker',
            'actions' => $this->calls === ['base', 'overlay', 'equal'],
            'late-replacement' => $this->getData('replaced') === 'from-php',
        ];
    }
}
