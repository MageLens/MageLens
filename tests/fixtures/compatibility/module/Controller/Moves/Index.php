<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Moves;

use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\App\RequestInterface;
use Magento\Framework\View\Result\Layout as Fragment;
use Magento\Framework\View\Result\LayoutFactory;
use MageLens\Compatibility\Model\LayoutMoveMutation;

class Index implements HttpGetActionInterface
{
    public function __construct(private LayoutFactory $layouts, private RequestInterface $request,
        private LayoutMoveMutation $mutation)
    {
    }

    public function execute(): Fragment
    {
        $case = $this->request->getParam('case');
        if (!in_array($case, ['after', 'before', 'equal', 'precedence', 'missing', 'destination', 'removed', 'programmatic', 'same', 'unchanged', 'sibling-missing', 'alias-fallback', 'overridden'], true)) {
            throw new \InvalidArgumentException('Expected a disposable move operand case');
        }
        $this->mutation->enabled = $case === 'programmatic';
        try {
            $fragment = $this->layouts->create();
            $fragment->addHandle('coverageprobe_moveoperands_' . $case);
            $layout = $fragment->getLayout();
            $moved = 'magelens.layout.moveoperand.movable';
            $left = 'magelens.layout.moveoperand.left';
            $right = 'magelens.layout.moveoperand.right';
            $anchor = 'magelens.layout.moveoperand.anchor';
            $tail = 'magelens.layout.moveoperand.tail';
            $parent = $layout->getParentName($moved);
            $expected = match ($case) {
                'before' => [$moved, $anchor, $tail],
                'equal', 'precedence', 'sibling-missing', 'alias-fallback' => [$anchor, $tail, $moved],
                'missing', 'destination', 'removed', 'same', 'unchanged' => [$anchor, $tail],
                default => [$anchor, $moved, $tail],
            };
            if ($layout->getChildNames($right) !== $expected
                || (in_array($case, ['missing', 'same', 'unchanged'], true) && $parent !== $left)
                || ($case === 'destination' && $parent !== false)
                || ($case === 'removed' && $layout->hasElement($moved))
                || (!in_array($case, ['missing', 'destination', 'removed', 'same', 'unchanged'], true) && $parent !== $right)) {
                throw new \RuntimeException('Native move did not produce the expected parent and sibling structure');
            }
            if (in_array($case, ['after', 'before', 'programmatic', 'overridden'], true)
                && $layout->getChildName($right, 'moved-alias') !== $moved) {
                throw new \RuntimeException('Native move did not apply its new alias');
            }
            if (in_array($case, ['equal', 'alias-fallback'], true) && $layout->getChildName($right, 'initial-alias') !== $moved) {
                throw new \RuntimeException('Native move did not retain the equal alias');
            }
            if ($case === 'same' && $layout->getChildName($left, 'moved-alias') !== $moved) {
                throw new \RuntimeException('Native same-parent move did not change its alias');
            }
            if ($case === 'programmatic' && $this->mutation->calls !== 1) {
                throw new \RuntimeException('Native equal-valued move rescheduling was bypassed');
            }
            return $fragment;
        } finally {
            $this->mutation->enabled = false;
        }
    }
}
