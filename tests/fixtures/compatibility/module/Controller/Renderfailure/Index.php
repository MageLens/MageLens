<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Renderfailure;

use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\App\State;
use Magento\Framework\Controller\Result\Raw;
use Magento\Framework\Controller\Result\RawFactory;
use Magento\Framework\Exception\ValidatorException;
use Magento\Framework\View\Result\LayoutFactory;

class Index implements HttpGetActionInterface
{
    public function __construct(private LayoutFactory $layouts, private RawFactory $raw, private State $state)
    {
    }

    public function execute(): Raw
    {
        $output = '';
        foreach (['empty', 'missing', 'throw', 'after'] as $case) {
            $fragment = $this->layouts->create();
            $fragment->addHandle('coverageprobe_renderfailure_' . $case);
            $block = $fragment->getLayout()->getBlock('magelens.layout.renderfailure.' . $case);
            $outcome = 'unexpected';
            try {
                $html = $block->toHtml();
                if ($html === '' && ($case === 'empty'
                    || ($case === 'missing' && $this->state->getMode() !== State::MODE_DEVELOPER))) $outcome = 'verified';
            } catch (ValidatorException $error) {
                if ($case !== 'missing' || $this->state->getMode() !== State::MODE_DEVELOPER
                    || !str_contains($error->getMessage(), 'layout-renderfailure-missing.phtml')) throw $error;
                $outcome = 'verified';
            } catch (\RuntimeException $error) {
                $expected = $case === 'after' ? 'Intentional failure after successful template execution'
                    : 'Intentional layout rendering failure';
                if (!in_array($case, ['throw', 'after'], true) || $error->getMessage() !== $expected) throw $error;
                $outcome = 'verified';
            }
            $output .= '<span data-layout-renderfailure="' . $case . '">' . $outcome . '</span>';
        }
        return $this->raw->create()->setContents($output);
    }
}
