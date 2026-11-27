<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
namespace Application\Blog\Controller\Index;

use Application\Blog\Model\Posts as PostProvider;
use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\App\RequestInterface;
use Magento\Framework\Controller\Result\JsonFactory;

class Posts implements HttpGetActionInterface
{
    public function __construct(private RequestInterface $request, private JsonFactory $json, private PostProvider $posts) {}
    public function execute()
    {
        $query = $this->request->getParam('q', '');
        $category = $this->request->getParam('category', '');
        $page = $this->request->getParam('page', '1');
        $result = $this->json->create();
        if (!is_string($query) || mb_strlen($query) > 200 || !is_string($category) ||
            ($category !== '' && !preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/D', $category)) || strlen($category) > 120 ||
            !is_scalar($page) || !preg_match('/^[1-9][0-9]{0,5}$/D', (string) $page)) {
            return $result->setHttpResponseCode(400)->setData(['error' => 'Invalid search, category or page.']);
        }
        return $result->setData($this->posts->listing(trim($query), $category, (int) $page));
    }
}
