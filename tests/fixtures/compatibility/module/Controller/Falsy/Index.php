<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Falsy;

use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\Controller\Result\Raw;
use Magento\Framework\Controller\Result\RawFactory;
use Magento\Framework\View\Result\LayoutFactory;

class Index implements HttpGetActionInterface
{
    public function __construct(private LayoutFactory $layouts, private RawFactory $raw)
    {
    }

    public function execute(): Raw
    {
        $fragment = $this->layouts->create();
        $fragment->addHandle(['coverageprobe_falsy_base', 'coverageprobe_falsy_overlay']);
        $layout = $fragment->getLayout();
        foreach (['native' => 19, 'zero' => 29, 'empty' => 29, 'padded' => 0, 'signed' => 0, 'override.zero' => 29, 'override.empty' => 29] as $case => $ttl) {
            $block = $layout->getBlock('magelens.falsy.' . $case);
            if (!$block || $block->getTemplate() !== 'MageLens_Compatibility::layout-falsy.phtml'
                || $block->getData('ttl') !== $ttl) throw new \RuntimeException('Native empty block attribute filtering changed: ' . $case);
        }
        if ($layout->getGroupChildNames('magelens.falsy.root', 'active') !== ['magelens.falsy.native']
            || $layout->getGroupChildNames('magelens.falsy.root', '00') !== ['magelens.falsy.padded']
            || $layout->getGroupChildNames('magelens.falsy.root', '0') !== []
            || $layout->getGroupChildNames('magelens.falsy.root', '') !== []
            || $layout->getElementProperty('magelens.falsy.zero', 'display') !== false
            || $layout->getElementProperty('magelens.falsy.hidden', 'display') !== '0'
            || $layout->getElementProperty('magelens.falsy.wrapper', 'label') !== '0'
            || $layout->isCacheable() !== true) throw new \RuntimeException('Native zero group, display, label or cacheability changed');
        foreach (['removed.block', 'removed.container', 'removed.child'] as $removed) {
            if ($layout->hasElement('magelens.falsy.' . $removed)) throw new \RuntimeException('Zero remove unexpectedly cancelled removal');
        }
        foreach (['restored.block', 'restored.container', 'restored.child', 'hidden.child'] as $present) {
            if (!$layout->hasElement('magelens.falsy.' . $present)) throw new \RuntimeException('Native false restoration or hidden structure changed');
        }
        $html = $layout->getOutput();
        foreach (['native', 'zero', 'empty', 'padded', 'signed', 'override.zero', 'override.empty', 'wrapper.child', 'restored.block', 'restored.child'] as $visible) {
            if (!str_contains($html, 'data-layout-falsy="magelens.falsy.' . $visible . '"')) throw new \RuntimeException('Native falsy output omitted ' . $visible);
        }
        foreach (['false', 'hidden.child', 'removed.block', 'removed.child'] as $hidden) {
            if (str_contains($html, 'data-layout-falsy="magelens.falsy.' . $hidden . '"')) throw new \RuntimeException('Native falsy output rendered ' . $hidden);
        }
        if (str_contains($html, 'class="0"') || !str_contains($html, '<section0>')) {
            throw new \RuntimeException('Native zero class interpolation changed');
        }
        return $this->raw->create()->setContents($html . '<span data-layout-falsy-proof>verified</span>');
    }
}
