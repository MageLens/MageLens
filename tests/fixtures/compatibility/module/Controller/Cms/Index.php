<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Cms;

use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\App\RequestInterface;
use Magento\Framework\App\ResourceConnection;
use Magento\Framework\Controller\Result\Forward;
use Magento\Framework\Controller\Result\ForwardFactory;
use Magento\Store\Model\StoreManagerInterface;

class Index implements HttpGetActionInterface
{
    public function __construct(private ForwardFactory $forward, private RequestInterface $request,
        private ResourceConnection $resources, private StoreManagerInterface $stores)
    {
    }

    private static function update(string $value): string
    {
        return '<referenceContainer name="magelens.layout.wireframe" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            . '<block class="Magento\Framework\View\Element\Template" name="magelens.layout.cms.inline" '
            . 'template="MageLens_Compatibility::layout-cms-database.phtml"><arguments>'
            . '<argument name="kind" xsi:type="string">inline</argument>'
            . '<argument name="value" xsi:type="string">' . $value . '</argument>'
            . '</arguments></block></referenceContainer>'
            . '<referenceBlock name="magelens.layout.cms.xml" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            . '<arguments><argument name="value" xsi:type="string">database-before-value</argument></arguments></referenceBlock>';
    }

    public function execute(): Forward
    {
        $case = $this->request->getParam('case');
        if (!in_array($case, ['native', 'inline', 'custom', 'expired'], true)) {
            throw new \InvalidArgumentException('Expected a known disposable CMS layout case');
        }
        $connection = $this->resources->getConnection();
        if ($connection->getTransactionLevel() !== 0) throw new \RuntimeException('Fixture requires its own transaction');
        $table = $this->resources->getTableName('cms_page');
        if ($connection->fetchOne($connection->select()->from($table, ['page_id'])
            ->where('identifier = ?', 'magelens_layout_cms_fixture')->limit(1))) {
            throw new \RuntimeException('Refusing to reuse an existing CMS fixture identifier');
        }
        $connection->beginTransaction();
        register_shutdown_function(static function () use ($connection): void {
            if ($connection->getTransactionLevel() > 0) $connection->rollBack();
        });
        $connection->insert($table, [
            'identifier' => 'magelens_layout_cms_fixture', 'title' => 'CMS runtime title',
            'meta_title' => 'CMS runtime title', 'page_layout' => 'magelens_fixture',
            'content' => '<div data-layout-cms-content>CMS fixture body</div>',
            'is_active' => 1, 'layout_update_selected' => 'selected',
            'layout_update_xml' => $case === 'native' ? '' : self::update('inline-value'),
            'custom_layout_update_xml' => in_array($case, ['custom', 'expired'], true) ? self::update('custom-value') : '',
            'custom_theme_from' => '2000-01-01',
            'custom_theme_to' => $case === 'custom' ? '2099-01-01' : '2000-01-02',
        ]);
        $id = (int) $connection->lastInsertId($table);
        $connection->insert($this->resources->getTableName('cms_page_store'),
            ['page_id' => $id, 'store_id' => (int) $this->stores->getStore()->getId()]);
        return $this->forward->create()->setModule('cms')->setController('page')->setParams(['page_id' => $id])->forward('view');
    }
}
