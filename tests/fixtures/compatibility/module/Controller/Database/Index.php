<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Database;

use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\App\RequestInterface;
use Magento\Framework\App\ResourceConnection;
use Magento\Framework\Controller\Result\Raw;
use Magento\Framework\Controller\Result\RawFactory;
use Magento\Framework\View\DesignInterface;
use Magento\Framework\View\Result\LayoutFactory;
use Magento\Store\Model\StoreManagerInterface;
use Magento\Theme\Model\ResourceModel\Theme\CollectionFactory;

class Index implements HttpGetActionInterface
{
    public function __construct(private LayoutFactory $layouts, private RawFactory $raw,
        private RequestInterface $request, private ResourceConnection $resources,
        private DesignInterface $design, private StoreManagerInterface $stores,
        private CollectionFactory $themes)
    {
    }

    public function execute(): Raw
    {
        $case = $this->request->getParam('case');
        if (!in_array($case, ['native', 'equal', 'nested', 'scalar'], true)) {
            throw new \InvalidArgumentException('Expected a known disposable database layout case');
        }
        $connection = $this->resources->getConnection();
        if ($connection->getTransactionLevel() !== 0) throw new \RuntimeException('Fixture requires its own transaction');
        $themeId = (int) $this->design->getDesignTheme()->getId();
        $inactiveTheme = $this->themes->create()->addFieldToFilter('area', 'frontend')
            ->addFieldToFilter('theme_path', 'MageLens/inactive')->getFirstItem();
        $storeId = (int) $this->stores->getStore()->getId();
        $otherStore = $this->stores->getStore('magelens_layout_fixture');
        if ((int) $otherStore->getId() === $storeId) $otherStore = $this->stores->getDefaultStoreView();
        if (!$inactiveTheme->getId() || (int) $inactiveTheme->getId() === $themeId
            || (int) $otherStore->getId() === $storeId) throw new \RuntimeException('Missing isolated provider contexts');
        $handle = 'magelens_database_' . $case . '_' . bin2hex(random_bytes(8));
        $name = 'magelens.layout.database.' . $case;
        $attributes = $case === 'equal'
            ? ' class="Magento\Framework\View\Element\Template" template="MageLens_Compatibility::layout-database.phtml"' : '';
        $argument = match ($case) {
            'native' => '',
            'equal' => '<argument name="value" xsi:type="string">xml-value</argument>',
            'nested' => '<argument name="nested" xsi:type="array"><item name="changed" xsi:type="string">xml-value</item></argument>',
            'scalar' => '<argument name="nested" xsi:type="string">xml-value</argument>',
        };
        $active = $case === 'native' ? '' : '<referenceBlock name="' . $name . '"' . $attributes
            . '><arguments>' . $argument . '</arguments></referenceBlock>';
        $excluded = '<referenceBlock name="' . $name . '"><arguments>'
            . '<argument name="value" xsi:type="string">inactive-provider</argument></arguments></referenceBlock>';
        $rows = [[$excluded, (int) $otherStore->getId(), $themeId, 0],
            [$excluded, $storeId, (int) $inactiveTheme->getId(), 0], [$excluded, $storeId, $themeId, 1]];
        if ($active !== '') $rows[] = [$active, $storeId, $themeId, 0];
        $connection->beginTransaction();
        try {
            foreach ($rows as [$xml, $store, $theme, $temporary]) {
                $connection->insert($this->resources->getTableName('layout_update'),
                    ['handle' => $handle, 'xml' => $xml, 'sort_order' => 1]);
                $id = (int) $connection->lastInsertId($this->resources->getTableName('layout_update'));
                $connection->insert($this->resources->getTableName('layout_link'),
                    ['layout_update_id' => $id, 'store_id' => $store, 'theme_id' => $theme, 'is_temporary' => $temporary]);
            }
            $fragment = $this->layouts->create();
            $fragment->addHandle('coverageprobe_database_' . $case)->addHandle($handle);
            $layout = $fragment->getLayout();
            if ($layout->getUpdate()->getDbUpdateString($handle) !== $active) {
                throw new \RuntimeException('Native widget resource selected the wrong database providers');
            }
            $block = $layout->getBlock($name);
            $nested = $case === 'scalar' ? 'xml-value' : ['changed' => 'xml-value', 'surviving' => 'xml-value'];
            if ($block->getData('value') !== 'xml-value' || $block->getData('nested') !== $nested) {
                throw new \RuntimeException('Native database layout replacement changed expected values');
            }
            if ($case !== 'scalar' && ($block->getDataByPath('nested/changed') !== 'xml-value'
                || $block->getDataByPath('nested/surviving') !== 'xml-value')) {
                throw new \RuntimeException('Native database layout replacement changed surviving leaves');
            }
            $html = $block->toHtml();
        } finally {
            $connection->rollBack();
        }
        return $this->raw->create()->setContents($html);
    }
}
