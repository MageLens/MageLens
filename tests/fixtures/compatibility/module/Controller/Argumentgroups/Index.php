<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Argumentgroups;

class Index extends \MageLens\Compatibility\Controller\Fragment\Index
{
    public function execute(): \Magento\Framework\View\Result\Layout
    {
        $result = parent::execute();
        $result->addHandle('coverageprobe_argumentgroups');
        $block = $result->getLayout()->getBlock('magelens.argument.groups');
        if (!$block || $block->getData('selected') !== 'first-group'
            || $block->getData('reference') !== 'first-reference-group'
            || $block->hasData('ignored') || $block->hasData('ignored_reference')) {
            throw new \RuntimeException('Native argument group selection changed');
        }
        return $result;
    }
}
