<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
namespace Application\Blog\Setup\Patch\Data;

use Magento\Framework\Setup\Patch\DataPatchInterface;
use Application\Blog\Model\{Categories, Posts};

class InitialArticles implements DataPatchInterface
{
    public function __construct(private Categories $categories, private Posts $posts) {}
    public function apply()
    {
        $category = $this->categories->save(['name' => 'Engineering', 'slug' => 'engineering', 'is_active' => 1]);
        foreach ([
            ['HTTP requests tell a story', 'Every request has a beginning and an outcome.', "Application behavior is easiest to understand through real requests.\n\nPublishing an article exercises routing, data access, and rendering together."],
            ['Small interactions matter', 'Useful interfaces start with clear feedback.', "Search, pagination, and saved favorites help readers find something worth reading.\n\nA reliable interface also explains empty results and failed requests."],
            ['From draft to publication', 'A publishing workflow connects editors and readers.', "Start with a draft, review the preview, and choose when to publish.\n\nReader comments remain private until an editor approves them."]
        ] as $index => [$title, $excerpt, $body]) {
            $this->posts->save(['title' => $title, 'slug' => ['http-requests', 'small-interactions', 'draft-to-publication'][$index], 'author' => 'Editorial team', 'excerpt' => $excerpt, 'body' => $body, 'category_id' => $category, 'status' => 'published']);
        }
        return $this;
    }
    public static function getDependencies(): array { return []; }
    public function getAliases(): array { return []; }
}
