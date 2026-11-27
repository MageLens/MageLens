<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
namespace Application\Blog\Controller\Post;

use Application\Blog\Model\{Posts, Comments};
use Magento\Framework\App\Action\HttpPostActionInterface;
use Magento\Framework\App\RequestInterface;
use Magento\Framework\Controller\Result\RedirectFactory;
use Magento\Framework\Exception\LocalizedException;
use Magento\Framework\Message\ManagerInterface;
use Magento\Framework\Data\Form\FormKey\Validator;
use Magento\Framework\Session\Generic;
use Psr\Log\LoggerInterface;

class Comment implements HttpPostActionInterface
{
    public function __construct(private Posts $posts, private Comments $comments, private RequestInterface $request,
        private RedirectFactory $redirects, private ManagerInterface $messages, private Generic $session, private LoggerInterface $logger, private Validator $formKeyValidator) {}
    public function execute()
    {
        $slug = (string) $this->request->getParam('slug');
        try {
            // Enforce the form key even for requests carrying an XHR header.
            if (!$this->formKeyValidator->validate($this->request)) throw new LocalizedException(__('Invalid form key. Refresh the page and try again.'));
            $post = $this->posts->published($slug);
            if ((int) $this->session->getBlogCommentTime() > time() - 60) throw new LocalizedException(__('Please wait a minute before commenting again.'));
            $this->comments->submit((int) $post['post_id'], (array) $this->request->getPostValue());
            $this->session->setBlogCommentTime(time());
            $this->messages->addSuccessMessage(__('Thank you. Your comment is awaiting moderation.'));
        } catch (LocalizedException $error) {
            $this->messages->addErrorMessage($error->getMessage());
        } catch (\Exception $error) {
            $this->logger->critical($error);
            $this->messages->addErrorMessage(__('Unable to save your comment. Please try again.'));
        }
        return $this->redirects->create()->setPath('blog/post/view', ['slug' => $slug]);
    }
}
