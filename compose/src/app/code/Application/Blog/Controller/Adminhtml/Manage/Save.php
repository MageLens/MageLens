<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
namespace Application\Blog\Controller\Adminhtml\Manage;
class Save extends Action implements \Magento\Framework\App\Action\HttpPostActionInterface
{
    public function execute()
    {
        $section = $this->section();
        $id = (int) $this->getRequest()->getParam('id');
        $input = (array) $this->getRequest()->getPostValue();
        try {
            $id = $this->editor->save($section, $input, $id, (array) $this->getRequest()->getFiles('featured_image'));
            $this->_session->unsBlogFormData();
            $this->messageManager->addSuccessMessage(__('Saved successfully.'));
        } catch (\Magento\Framework\Exception\LocalizedException $error) {
            $this->_session->setBlogFormData(['section' => $section, 'id' => $id, 'values' => $input]);
            $this->messageManager->addErrorMessage($error->getMessage());
        } catch (\Exception $error) {
            $this->logger->critical($error);
            $this->_session->setBlogFormData(['section' => $section, 'id' => $id, 'values' => $input]);
            $this->messageManager->addErrorMessage(__('Unable to save. Check the application log and try again.'));
        }
        return $this->resultRedirectFactory->create()->setPath('*/*/edit', ['section' => $section, 'id' => $id]);
    }
}
