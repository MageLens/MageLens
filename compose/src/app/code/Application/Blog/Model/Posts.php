<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
namespace Application\Blog\Model;

use Magento\Framework\App\ResourceConnection;
use Magento\Framework\DB\Adapter\DuplicateException;
use Magento\Framework\Exception\LocalizedException;
use Magento\Framework\Exception\NoSuchEntityException;
use Magento\Store\Model\StoreManagerInterface;

class Posts
{
    public const PAGE_SIZE = 6;
    public function __construct(
        private ResourceConnection $resource, private Validation $validation,
        private Categories $categories, private Images $images, private StoreManagerInterface $stores
    ) {}

    public function get(int $id): array
    {
        $db = $this->resource->getConnection();
        $row = $db->fetchRow($db->select()->from($this->resource->getTableName('application_blog_post'))->where('post_id = ?', $id));
        if (!$row) throw new NoSuchEntityException(__('This post no longer exists.'));
        return $row;
    }

    private function publishedSelect()
    {
        $db = $this->resource->getConnection();
        return $db->select()->from(['p' => $this->resource->getTableName('application_blog_post')])
            ->join(['c' => $this->resource->getTableName('application_blog_category')], 'c.category_id = p.category_id', ['category' => 'name', 'category_slug' => 'slug'])
            ->where('p.status = ?', 'published')->where('c.is_active = ?', 1)
            ->where('p.published_at IS NOT NULL AND p.published_at <= ?', gmdate('Y-m-d H:i:s'));
    }

    public function published(string $slug): array
    {
        $row = $this->resource->getConnection()->fetchRow($this->publishedSelect()->where('p.slug = ?', $slug));
        if (!$row) throw new NoSuchEntityException(__('This post is not available.'));
        return $this->present($row);
    }

    public function listing(string $query = '', string $category = '', int $page = 1): array
    {
        $db = $this->resource->getConnection();
        $select = $this->publishedSelect();
        if ($category !== '') $select->where('c.slug = ?', $category);
        if ($query !== '') {
            $term = '%' . addcslashes($query, '\\%_') . '%';
            $select->where($db->quoteInto('p.title LIKE ?', $term) . ' OR ' . $db->quoteInto('p.excerpt LIKE ?', $term));
        }
        $count = clone $select;
        $total = (int) $db->fetchOne($count->reset(\Magento\Framework\DB\Select::COLUMNS)->columns(new \Zend_Db_Expr('COUNT(*)')));
        $pages = max(1, (int) ceil($total / self::PAGE_SIZE));
        $page = min(max(1, $page), $pages);
        $rows = $db->fetchAll($select->order(['p.published_at DESC', 'p.post_id DESC'])->limitPage($page, self::PAGE_SIZE));
        return ['posts' => array_map($this->present(...), $rows), 'total' => $total, 'page' => $page, 'pages' => $pages];
    }

    private function present(array $row): array
    {
        $store = $this->stores->getStore();
        $row['id'] = (int) $row['post_id'];
        $row['url'] = $store->getUrl('blog/post/view', ['slug' => $row['slug'], '_nosid' => true]);
        $row['image_url'] = $row['image'] ? $store->getBaseUrl(\Magento\Framework\UrlInterface::URL_TYPE_MEDIA) . $row['image'] : '';
        return $row;
    }

    public function save(array $input, int $id = 0, array $file = []): int
    {
        $old = $id ? $this->get($id) : [];
        $category = $this->categories->get((int) ($input['category_id'] ?? 0));
        $status = $this->validation->text($input, 'status', 16);
        if (!in_array($status, ['draft', 'published'], true)) throw new LocalizedException(__('Choose Draft or Published.'));
        $date = $this->validation->publication($input);
        if ($status === 'published' && !$date) $date = gmdate('Y-m-d H:i:s');
        $data = [
            'title' => $this->validation->text($input, 'title', 200), 'slug' => $this->validation->slug($input),
            'author' => $this->validation->text($input, 'author', 120), 'excerpt' => $this->validation->text($input, 'excerpt', 1000),
            'body' => $this->validation->text($input, 'body', 100000), 'category_id' => $category['category_id'],
            'status' => $status, 'published_at' => $date,
            'meta_title' => $this->validation->text($input, 'meta_title', 200, false),
            'meta_description' => $this->validation->text($input, 'meta_description', 300, false),
        ];
        $upload = $this->images->upload($file);
        $data['image'] = $upload ?? (empty($input['remove_image']) ? ($old['image'] ?? null) : null);
        $db = $this->resource->getConnection();
        $table = $this->resource->getTableName('application_blog_post');
        try {
            if ($id) $db->update($table, $data, ['post_id = ?' => $id]);
            else { $db->insert($table, $data); $id = (int) $db->lastInsertId($table); }
        } catch (\Exception $error) {
            $this->images->delete($upload);
            if ($error instanceof DuplicateException) throw new LocalizedException(__('A post with this slug already exists.'));
            throw $error;
        }
        if (($old['image'] ?? null) !== $data['image']) $this->images->delete($old['image'] ?? null);
        return $id;
    }

    public function delete(int $id): void
    {
        $post = $this->get($id);
        $this->resource->getConnection()->delete($this->resource->getTableName('application_blog_post'), ['post_id = ?' => $id]);
        $this->images->delete($post['image']);
    }

    // An editorial feature intentionally outside the published workflow.
    public function editorialPreview(): array
    {
        return ['title' => 'An unpublished post', 'published' => false];
    }
}
