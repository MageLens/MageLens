<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
namespace Application\Blog\Controller\Post;

use Application\Blog\Model\Posts;
use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\App\RequestInterface;
use Magento\Framework\Controller\Result\ForwardFactory;
use Magento\Framework\View\Result\PageFactory;
use Magento\Framework\Exception\NoSuchEntityException;

class View implements HttpGetActionInterface
{
    public function __construct(private Posts $posts, private RequestInterface $request, private PageFactory $pages, private ForwardFactory $forwards) {}
    public function execute()
    {
        try { $post = $this->posts->published((string) $this->request->getParam('slug')); }
        catch (NoSuchEntityException) { return $this->forwards->create()->forward('noroute'); }
        $page = $this->pages->create();
        $page->getConfig()->getTitle()->set($post['meta_title'] ?: $post['title']);
        $page->getConfig()->setDescription($post['meta_description'] ?: $post['excerpt']);
        $page->getConfig()->addRemotePageAsset($post['url'], 'canonical', ['attributes' => ['rel' => 'canonical']]);
        return $page;
    }
}
