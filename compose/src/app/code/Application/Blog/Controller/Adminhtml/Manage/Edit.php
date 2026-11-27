<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
namespace Application\Blog\Controller\Adminhtml\Manage;
class Edit extends Action implements \Magento\Framework\App\Action\HttpGetActionInterface
{
    public function execute()
    {
        $section = $this->section();
        $id = (int) $this->getRequest()->getParam('id');
        try {
            if ($id) $this->editor->get($section, $id);
            elseif ($section === 'comments') throw new \Magento\Framework\Exception\LocalizedException(__('Select a comment to moderate.'));
            return $this->page(($id ? 'Edit ' : 'New ') . $section);
        } catch (\Magento\Framework\Exception\LocalizedException $error) {
            $this->messageManager->addErrorMessage($error->getMessage());
            return $this->resultRedirectFactory->create()->setPath('*/*/index', ['section' => $section]);
        }
    }
}
