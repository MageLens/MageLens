<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

use Magento\Framework\View\Layout\Generator\Context;
use Magento\Framework\View\Layout\GeneratorPool;
use Magento\Framework\View\Layout\Reader\Context as ReaderContext;

class LayoutMoveMutation
{
    public bool $enabled = false;
    public int $calls = 0;
    public bool $replaceReferenceChild = false;
    public int $referenceCalls = 0;

    public function beforeProcess(GeneratorPool $pool, ReaderContext $reader, Context $context): void
    {
        if ($this->replaceReferenceChild) {
            $schedule = $reader->getScheduledStructure();
            $name = 'magelens.reference.attached';
            $row = $schedule->getStructureElement($name);
            if ($row === null) throw new \RuntimeException('Expected an original reference child before equal rescheduling');
            $schedule->setStructureElement($name, $row);
            $this->referenceCalls++;
        }
        if (!$this->enabled) return;
        $schedule = $reader->getScheduledStructure();
        $name = 'magelens.layout.moveoperand.movable';
        $move = $schedule->getElementToMove($name);
        if ($move === null) throw new \RuntimeException('Expected an existing XML move before native rescheduling');
        $schedule->setElementToMove($name, $move);
        $this->calls++;
    }
}
