<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
namespace Application\Blog\Block\Adminhtml;

use Application\Blog\Model\{Editor, Categories};
use Magento\Backend\Block\Template\Context;
use Magento\Backend\Model\Session;

class Manage extends \Magento\Backend\Block\Template
{
    public function __construct(Context $context, private Editor $editor, private Categories $categories, private Session $session, array $data = [])
    {
        parent::__construct($context, $data);
    }
    public function section(): string { return $this->editor->section((string) $this->getRequest()->getParam('section', 'posts')); }
    public function recordId(): int { return (int) $this->getRequest()->getParam('id'); }
    public function listing(): array { return $this->editor->listing($this->section(), $this->query(), (int) $this->getRequest()->getParam('p', 1)); }
    public function query(): string { return mb_substr((string) $this->getRequest()->getParam('q', ''), 0, 200); }
    public function categories(): array { return $this->categories->all(); }
    public function record(): array
    {
        $record = $this->recordId() ? $this->editor->get($this->section(), $this->recordId()) : [];
        $form = $this->session->getBlogFormData(true);
        if ($form && $form['section'] === $this->section() && $form['id'] === $this->recordId()) $record = array_replace($record, $form['values']);
        return $record;
    }
    public function actionUrl(string $action, array $params = []): string
    {
        return $this->getUrl('application_blog/manage/' . $action, array_replace(['section' => $this->section()], $params));
    }
}
