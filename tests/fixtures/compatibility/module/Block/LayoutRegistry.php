<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);

namespace MageLens\Compatibility\Block;

use Magento\Framework\View\Element\Template;
use Magento\Framework\View\Model\PageLayout\Config\BuilderInterface;
use Magento\Framework\View\Layout\PageType\Config as PageTypeConfig;

class LayoutRegistry extends Template
{
    public function __construct(
        Template\Context $context,
        private BuilderInterface $pageLayouts,
        private PageTypeConfig $pageTypes,
        private \Magento\Theme\Model\PageLayout\Config\BuilderFactory $pageLayoutsFactory,
        private \Magento\Framework\App\Cache\Type\Layout $layoutCache,
        array $data = []
    ) {
        parent::__construct($context, $data);
    }

    public function wireframeEffects(): array
    {
        $layout = $this->getLayout();
        return [
            'move' => $layout->getParentName('magelens.layout.wireframe.movable') === 'magelens.layout.wireframe',
            'removal' => !$layout->hasElement('magelens.layout.wireframe.removed'),
            'nested-block' => $layout->getBlock('magelens.layout.wireframe.nested-block') instanceof Template,
            'ttl' => $layout->getBlock('magelens.layout.wireframe.nested-block')->getData('ttl') === 47,
            'cacheable' => $layout->isCacheable(),
            'ignored-body' => !$layout->hasElement('magelens.layout.wireframe.ignored-body'),
        ];
    }

    public function handleMetadataEffects(): array
    {
        $updates = $this->getLayout()->getUpdate();
        $metadata = $updates->getAllDesignAbstractions();
        $custom = $metadata['coverageprobe_metadata_custom'] ?? [];
        $wireframe = $metadata['coverageprobe_metadata_wireframe'] ?? [];
        $containers = $updates->getContainers();
        return [
            'custom' => ($custom['label'] ?? null) === 'Registry custom label' && $updates->isCustomerDesignAbstraction($custom),
            'wireframe' => ($wireframe['label'] ?? null) === 'Registry wireframe label'
                && $updates->isPageLayoutDesignAbstraction($wireframe),
            'equal' => ($metadata['coverageprobe_metadata_equal']['label'] ?? null) === 'Registry equal label',
            'filtered' => !isset($metadata['coverageprobe_metadata_untyped']),
            'available' => in_array('coverageprobe_metadata_untyped', $updates->getAvailableHandles(), true),
            'containers' => ($containers['magelens.layout.metadata-container'] ?? null) === 'Snapshot container label',
        ];
    }

    public function registryEffects(): array
    {
        $this->layoutCache->remove(\Magento\Theme\Model\PageLayout\Config\Builder::CACHE_KEY_LAYOUTS);
        $config = $this->pageLayoutsFactory->create()->getPageLayoutsConfig();
        $options = array_column($config->toOptionArray(), 'label', 'value');
        $types = $this->pageTypes->getPageTypes();
        return [
            'membership' => $config->hasPageLayout('magelens_fixture') && !$config->hasPageLayout('magelens_registry_missing'),
            'override' => ($options['magelens_registry_override'] ?? null) === 'Registry overlay',
            'equal' => ($options['magelens_registry_equal'] ?? null) === 'Registry equal',
            'empty' => ($options['magelens_registry_empty'] ?? null) === 'Registry retained',
            'mixed' => ($options['magelens_registry_mixed'] ?? null) === 'Base prefixoverlay middle base suffix',
            'cdata-equal' => ($options['magelens_registry_cdata_equal'] ?? null) === 'Registry CDATA equal',
            'cdata' => ($options['magelens_registry_cdata'] ?? null) === '',
            'translation-flag' => ($options['magelens_fixture'] ?? null) === 'MageLens fixture wireframe'
                && (string) __('MageLens fixture wireframe') === 'Translated wireframe label',
            'page-type' => ($types['magelens_page_type_fixture'] ?? null)?->getData('id') === 'magelens_page_type_fixture'
                && $types['magelens_page_type_fixture']->getData('label') === 'Translated page type overlay',
            'page-type-equal' => ($types['magelens_page_type_equal'] ?? null)?->getData('label') === 'Page type equal',
        ];
    }

    public function fixtureLayoutLabel(): string
    {
        return $this->pageLayouts->getPageLayoutsConfig()->getOptions()['magelens_fixture'] ?? '';
    }
}
