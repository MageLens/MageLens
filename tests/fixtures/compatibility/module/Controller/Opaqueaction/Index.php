<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Opaqueaction;

use MageLens\Compatibility\Model\{LayoutOpaqueActionParser, LayoutOpaqueActionValue};
use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\App\Cache\StateInterface;
use Magento\Framework\App\ViewInterface;
use Magento\Framework\Controller\Result\{Raw, RawFactory};
use Magento\Framework\View\Layout\Reader\Block as BlockReader;
use Magento\Framework\View\Result\PageFactory;

class Index implements HttpGetActionInterface
{
    public function __construct(private PageFactory $pages, private RawFactory $raw, private StateInterface $state, ViewInterface $view) {}

    public function execute(): Raw
    {
        $active = true;
        $saved = [];
        $previous = [];
        $slot = new \ReflectionProperty(BlockReader::class, 'argumentParser');
        $entry = \OpenTelemetry\Instrumentation\hook(BlockReader::class, 'getActions',
            static function ($reader) use ($slot, &$saved, &$active): void {
                if (!$active) return;
                $saved[] = [$reader, $slot->getRawValue($reader)];
                $slot->setRawValue($reader, new LayoutOpaqueActionParser());
            }, static function ($reader) use ($slot, &$saved, &$active): void {
                if (!$active) return;
                [$owner, $parser] = array_pop($saved);
                if ($reader !== $owner) throw new \LogicException('Unbalanced opaque parser fixture');
                $slot->setRawValue($reader, $parser);
            });
        if (!$entry) throw new \RuntimeException('Cannot configure disposable opaque parser fixture');
        try {
            foreach (['layout', 'block_html'] as $type) {
                $previous[$type] = $this->state->isEnabled($type);
                $this->state->setEnabled($type, false);
            }
            $page = $this->pages->create(true, ['isIsolated' => true]);
            $page->addHandle('coverageprobe_packagemutation_native');
            $layout = $page->getLayout();
            $layout->getUpdate()->load();
            $layout->getUpdate()->addUpdate('<body><referenceBlock name="magelens.layout.package.native"><action method="setData"><argument name="key" xsi:type="string">opaque_probe</argument><argument name="value" xsi:type="string">opaque</argument></action></referenceBlock></body>');
            $block = $layout->getBlock('magelens.layout.package.native');
            $html = $block?->toHtml();
            if (!$block || !$block->getData('opaque_probe') instanceof LayoutOpaqueActionValue
                || !is_string($html) || !str_contains($html, 'data-layout-mutation>xml-value</span>')
                || LayoutOpaqueActionValue::$serializations !== 0 || $saved) {
                throw new \RuntimeException('Opaque parser changed native output or executed application serialization');
            }
            return $this->raw->create()->setContents($html . '<span data-layout-opaque-action>verified</span>');
        } finally {
            $active = false;
            foreach (array_reverse($saved) as [$reader, $parser]) $slot->setRawValue($reader, $parser);
            foreach ($previous as $type => $enabled) $this->state->setEnabled($type, $enabled);
        }
    }
}
