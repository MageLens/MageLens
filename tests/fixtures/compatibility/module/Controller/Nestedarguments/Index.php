<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Nestedarguments;

use MageLens\Compatibility\Model\LayoutArgumentSource;
use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\Controller\Result\Raw;
use Magento\Framework\Controller\Result\RawFactory;
use Magento\Framework\View\Result\LayoutFactory;

class Index implements HttpGetActionInterface
{
    public function __construct(private LayoutFactory $layouts, private RawFactory $raw) {}

    public function execute(): Raw
    {
        $fragment = $this->layouts->create();
        $fragment->addHandle('coverageprobe_nestedarguments');
        $block = $fragment->getLayout()->getBlock('magelens.nested.arguments');
        $values = $block?->getData('values');
        if (!is_array($values) || $block->hasData('ignored')) throw new \RuntimeException('Native nested group selection changed');
        $checks = [
            'shared' => $values['shared_first'] instanceof LayoutArgumentSource && $values['shared_first'] === $values['shared_second'],
            'fresh' => $values['fresh_first'] instanceof LayoutArgumentSource && $values['fresh_second'] instanceof LayoutArgumentSource
                && $values['fresh_first'] !== $values['fresh_second'] && $values['fresh_first'] !== $values['shared_first'],
            'translate' => $values['translated'] === 'MageLens nested translation marker' && $values['untranslated'] === $values['translated'],
            'options' => $values['options'] === [['value' => 'fixture-option', 'label' => 'Fixture label']],
            'helper' => $values['helper'] === 'nested:helper',
            'url' => is_string($values['route']) && str_ends_with((string) parse_url($values['route'], PHP_URL_PATH), '/coverageprobe/nestedarguments/index/variant/nested/'),
        ];
        $html = '';
        foreach ($checks as $case => $passed) {
            if (!$passed) throw new \RuntimeException('Native nested argument effect changed: ' . $case);
            $html .= '<span data-layout-nested-argument="' . $case . '">verified</span>';
        }
        return $this->raw->create()->setContents($html);
    }
}
