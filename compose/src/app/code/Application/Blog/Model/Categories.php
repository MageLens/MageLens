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
use Magento\Framework\Exception\NoSuchEntityException;

class Categories
{
    public function __construct(private ResourceConnection $resource, private Validation $validation) {}
    public function all(bool $activeOnly = false): array
    {
        $select = $this->resource->getConnection()->select()->from($this->resource->getTableName('application_blog_category'))->order('name ASC');
        if ($activeOnly) $select->where('is_active = ?', 1);
        return $this->resource->getConnection()->fetchAll($select);
    }
    public function get(int $id): array
    {
        $db = $this->resource->getConnection();
        $row = $db->fetchRow($db->select()->from($this->resource->getTableName('application_blog_category'))->where('category_id = ?', $id));
        if (!$row) throw new NoSuchEntityException(__('Category not found.'));
        return $row;
    }
    public function save(array $input, int $id = 0): int
    {
        if ($id) $this->get($id);
        $data = ['name' => $this->validation->text($input, 'name', 120), 'slug' => $this->validation->slug($input, 120), 'is_active' => !empty($input['is_active']) ? 1 : 0];
        $db = $this->resource->getConnection();
        $table = $this->resource->getTableName('application_blog_category');
        try {
            if ($id) $db->update($table, $data, ['category_id = ?' => $id]);
            else { $db->insert($table, $data); $id = (int) $db->lastInsertId($table); }
        } catch (\Magento\Framework\DB\Adapter\DuplicateException $error) {
            throw new LocalizedException(__('A category with this slug already exists.'), $error);
        }
        return $id;
    }
    public function delete(int $id): void
    {
        $this->get($id);
        $db = $this->resource->getConnection();
        if ($db->fetchOne($db->select()->from($this->resource->getTableName('application_blog_post'), 'COUNT(*)')->where('category_id = ?', $id))) {
            throw new LocalizedException(__('Move or delete this category\'s posts first.'));
        }
        $db->delete($this->resource->getTableName('application_blog_category'), ['category_id = ?' => $id]);
    }
}
