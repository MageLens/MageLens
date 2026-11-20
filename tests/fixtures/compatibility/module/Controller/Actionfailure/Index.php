<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Actionfailure;

use MageLens\Compatibility\Block\LayoutFailedAction;
use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\App\State;
use Magento\Framework\Controller\Result\Raw;
use Magento\Framework\Controller\Result\RawFactory;
use Magento\Framework\View\Result\LayoutFactory;

class Index implements HttpGetActionInterface
{
    public function __construct(private LayoutFactory $layouts, private RawFactory $raw, private State $state) {}
    public function execute(): Raw
    {
        $html = '';
        foreach (LayoutFailedAction::$onlyCase === null ? ['body', 'interpreter', 'partial', 'dispatch', 'type', 'denied', 'success'] : [LayoutFailedAction::$onlyCase] as $case) {
            LayoutFailedAction::$entered = [];
            LayoutFailedAction::$applied = false;
            \MageLens\Compatibility\Model\LayoutFailedActionOptions::$calls = 0;
            $fragment = $this->layouts->create();
            $fragment->addHandle('coverageprobe_actionfailure_' . $case);
            $block = null; $caught = null;
            try { $block = $fragment->getLayout()->getBlock('magelens.action.failure.' . $case); }
            catch (\Throwable $error) { $caught = $error; }
            $exception = match ($case) {
                'body' => \RuntimeException::class,
                'interpreter', 'partial' => \InvalidArgumentException::class,
                'dispatch' => \Magento\Framework\Exception\LocalizedException::class,
                'type' => \TypeError::class,
                default => null,
            };
            $throws = $exception !== null && ($case === 'type' || $this->state->getMode() === State::MODE_DEVELOPER);
            $expected = match ($case) { 'body' => ['body'], 'denied' => ['after'], 'success' => ['success', 'after'], default => [] };
            if (($throws && !($caught instanceof $exception)) || (!$throws && $caught !== null)
                || LayoutFailedAction::$entered !== $expected || LayoutFailedAction::$applied !== ($case === 'body')
                || \MageLens\Compatibility\Model\LayoutFailedActionOptions::$calls !== ($case === 'partial' ? 1 : 0)
                || (!$throws && !$block)
                || (!$throws && $exception !== null && !($block instanceof \Magento\Framework\View\Element\ExceptionHandlerBlock))) {
                throw new \RuntimeException('Native failed action boundary changed: ' . json_encode([
                    'case' => $case, 'exception' => $caught ? get_class($caught) : null,
                    'entries' => LayoutFailedAction::$entered, 'block' => $block ? get_class($block) : null,
                ]));
            }
            $html .= '<span data-layout-action-failure="' . $case . '">verified</span>';
        }
        return $this->raw->create()->setContents($html);
    }
}
