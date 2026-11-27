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

class Comments
{
    public function __construct(private ResourceConnection $resource, private Validation $validation) {}
    public function approved(int $postId): array
    {
        $db = $this->resource->getConnection();
        // Never expose email addresses in storefront responses.
        return $db->fetchAll($db->select()->from($this->resource->getTableName('application_blog_comment'), ['name', 'body', 'created_at'])
            ->where('post_id = ?', $postId)->where('status = ?', 'approved')->order(['created_at ASC', 'comment_id ASC']));
    }
    public function submit(int $postId, array $input): int
    {
        $data = ['post_id' => $postId, 'name' => $this->validation->text($input, 'name', 120),
            'email' => $this->validation->text($input, 'email', 254), 'body' => $this->validation->text($input, 'body', 5000), 'status' => 'pending'];
        if (!filter_var($data['email'], FILTER_VALIDATE_EMAIL)) throw new LocalizedException(__('Enter a valid email address.'));
        if (!empty($input['website'])) throw new LocalizedException(__('Unable to accept this comment.'));
        $db = $this->resource->getConnection();
        $table = $this->resource->getTableName('application_blog_comment');
        if ($db->fetchOne($db->select()->from($table, ['comment_id'])->where('post_id = ?', $postId)->where('email = ?', $data['email'])
            ->where('created_at > ?', gmdate('Y-m-d H:i:s', time() - 60))->limit(1))) {
            throw new LocalizedException(__('Please wait a minute before commenting again.'));
        }
        $db->insert($table, $data);
        return (int) $db->lastInsertId($table);
    }
    public function get(int $id): array
    {
        $db = $this->resource->getConnection();
        $row = $db->fetchRow($db->select()->from($this->resource->getTableName('application_blog_comment'))->where('comment_id = ?', $id));
        if (!$row) throw new NoSuchEntityException(__('This comment no longer exists.'));
        return $row;
    }
    public function save(array $input, int $id): int
    {
        $this->get($id);
        $status = $this->validation->text($input, 'status', 16);
        if (!in_array($status, ['pending', 'approved', 'rejected'], true)) throw new LocalizedException(__('Choose a valid moderation status.'));
        $this->resource->getConnection()->update($this->resource->getTableName('application_blog_comment'), ['status' => $status], ['comment_id = ?' => $id]);
        return $id;
    }
    public function delete(int $id): void
    {
        $this->get($id);
        $this->resource->getConnection()->delete($this->resource->getTableName('application_blog_comment'), ['comment_id = ?' => $id]);
    }
}
