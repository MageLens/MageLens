<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Observer;

class LayoutXmlMutation implements \Magento\Framework\Event\ObserverInterface
{
    public function execute(\Magento\Framework\Event\Observer $observer): void
    {
        $layout = $observer->getLayout();
        foreach (['direct', 'clone', 'replace'] as $case) {
            if (!in_array('coverageprobe_mutation_' . $case, $layout->getUpdate()->getHandles(), true)) continue;
            $xml = $layout->getNode();
            $node = $xml->xpath('//block[@name="magelens.layout.mutation.' . $case . '"]')[0];
            if ($case === 'direct') {
                $node['template'] = 'MageLens_Compatibility::layout-mutation.phtml';
                $node->arguments->argument[0] = 'php-value';
            } elseif ($case === 'clone') {
                $element = dom_import_simplexml($node);
                $element->parentNode->replaceChild($element->cloneNode(true), $element);
            } else {
                $layout->setXml($xml);
            }
        }
    }
}
