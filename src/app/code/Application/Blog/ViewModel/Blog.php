<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
namespace Application\Blog\ViewModel;

use Application\Blog\Model\{Posts, Categories, Comments};
use Magento\Framework\App\RequestInterface;
use Magento\Framework\View\Element\Block\ArgumentInterface;

class Blog implements ArgumentInterface
{
    public function __construct(private Posts $posts, private Categories $categories, private Comments $comments, private RequestInterface $request) {}
    public function introduction(): string
    {
        $count = $this->posts->listing()['total'];
        return $count === 1 ? 'One article to explore.' : "$count articles to explore.";
    }
    public function categories(): array { return $this->categories->all(true); }
    public function current(): array { return $this->posts->published((string) $this->request->getParam('slug')); }
    public function comments(int $postId): array { return $this->comments->approved($postId); }
}
