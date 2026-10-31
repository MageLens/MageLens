<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
namespace MageLens\Compatibility\Block;
class Probe extends \Magento\Framework\View\Element\Template
{
    public function __construct(\Magento\Framework\View\Element\Template\Context $context, private \Magento\Framework\Data\Form\FormKey $formKey, array $data = []) { parent::__construct($context, $data); }
    public function getFormKey(): string { return $this->formKey->getFormKey(); }
}
