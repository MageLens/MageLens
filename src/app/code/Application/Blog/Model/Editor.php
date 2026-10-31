<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
namespace Application\Blog\Model;

use Magento\Framework\App\ResourceConnection;
use Magento\Framework\Exception\LocalizedException;

class Editor
{
    public const SECTIONS = ['posts' => ['post', 'post_id', 'title'], 'categories' => ['category', 'category_id', 'name'], 'comments' => ['comment', 'comment_id', 'name']];
    public function __construct(private Posts $posts, private Categories $categories, private Comments $comments, private ResourceConnection $resource) {}
    public function section(string $section): string
    {
        if (!isset(self::SECTIONS[$section])) throw new LocalizedException(__('Unknown Blog section.'));
        return $section;
    }
    private function service(string $section): Posts|Categories|Comments
    {
        $this->section($section);
        return match ($section) { 'posts' => $this->posts, 'categories' => $this->categories, 'comments' => $this->comments };
    }
    public function get(string $section, int $id): array { return $this->service($section)->get($id); }
    public function save(string $section, array $input, int $id, array $file): int
    {
        if ($section === 'comments' && !$id) throw new LocalizedException(__('Comments are submitted through the storefront.'));
        return $section === 'posts' ? $this->posts->save($input, $id, $file) : $this->service($section)->save($input, $id);
    }
    public function delete(string $section, int $id): void { $this->service($section)->delete($id); }
    public function listing(string $section, string $query, int $page): array
    {
        [$table, $key, $label] = self::SECTIONS[$this->section($section)];
        $db = $this->resource->getConnection();
        $select = $db->select()->from($this->resource->getTableName('application_blog_' . $table));
        if ($query !== '') $select->where($label . ' LIKE ?', '%' . addcslashes($query, '\\%_') . '%');
        $count = clone $select;
        $total = (int) $db->fetchOne($count->reset(\Magento\Framework\DB\Select::COLUMNS)->columns(new \Zend_Db_Expr('COUNT(*)')));
        $pages = max(1, (int) ceil($total / 20));
        $page = min(max(1, $page), $pages);
        return ['rows' => $db->fetchAll($select->order($key . ' DESC')->limitPage($page, 20)), 'total' => $total, 'page' => $page, 'pages' => $pages, 'key' => $key, 'label' => $label];
    }
}
