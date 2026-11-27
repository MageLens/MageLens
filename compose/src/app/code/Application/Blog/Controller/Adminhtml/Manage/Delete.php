<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
namespace Application\Blog\Controller\Adminhtml\Manage;
class Delete extends Action implements \Magento\Framework\App\Action\HttpPostActionInterface
{
    public function execute()
    {
        $section = $this->section();
        try {
            $this->editor->delete($section, (int) $this->getRequest()->getParam('id'));
            $this->messageManager->addSuccessMessage(__('Deleted successfully.'));
        } catch (\Magento\Framework\Exception\LocalizedException $error) {
            $this->messageManager->addErrorMessage($error->getMessage());
        } catch (\Exception $error) {
            $this->logger->critical($error);
            $this->messageManager->addErrorMessage(__('Unable to delete. Check the application log and try again.'));
        }
        return $this->resultRedirectFactory->create()->setPath('*/*/index', ['section' => $section]);
    }
}
