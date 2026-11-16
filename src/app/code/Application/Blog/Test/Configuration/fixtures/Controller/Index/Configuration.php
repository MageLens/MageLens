<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace Application\Blog\Controller\Index;

// Installed only in the disposable E2E Blog module. Never copied to a user's shop.
class Configuration implements \Magento\Framework\App\Action\HttpGetActionInterface
{
    public function __construct(
        private \Magento\Framework\App\Config\ScopeConfigInterface $config,
        private \Magento\Framework\App\RequestInterface $request,
        private \Magento\Framework\Controller\Result\JsonFactory $json,
        private \Magento\Framework\Controller\Result\RawFactory $raw,
        private \Magento\Store\Model\StoreManagerInterface $stores,
        private \Magento\Backend\App\ConfigInterface $backend,
        private \Magento\Framework\Event\ManagerInterface $events,
        private \Application\Blog\Model\JournalPluginSubject $pluginSubject
    ) {}
    public function execute()
    {
        $case = preg_replace('/-warm$/', '', (string) $this->request->getParam('case'));
        $path = 'application_blog/display/';
        $result = [];
        $scope = match ($case) {
            'website-read' => ['websites', 'journal_website'],
            'website-inherits-default' => ['website', 'journal_other_website'],
            'store-read' => ['stores', 'journal_store'],
            'store-inherits-website' => ['store', 'journal_inherited_store'],
            'store-inherits-default', 'database-override' => ['stores', 'journal_other_store'],
            default => ['default', null],
        };
        switch ($case) {
            case 'baseline': break;
            case 'preference-resolution':
                $result = \Application\Blog\Model\JournalPreferenceProbe::exercise();
                break;
            case 'backend-reads':
                $result['heading'] = $this->backend->getValue('application_blog/backend/heading');
                $result['enabled'] = $this->backend->isSetFlag('application_blog/backend/enabled');
                break;
            case 'store-alias-read':
                $result['heading'] = $this->config->getValue($path . 'heading', 'store', 'Journal_Mixed');
                $result['lowercase'] = $this->config->getValue($path . 'heading', 'store', 'journal_mixed');
                break;
            case 'observer-dispatch':
                $counter = new \Magento\Framework\DataObject(['hits' => 0]);
                $this->events->dispatch('MageLens_Journal_Observers', ['counter' => $counter]);
                $result = $counter->getData() + ['plugin' => $this->pluginSubject->probe('start')];
                break;
            case 'warmup-only':
                $warm = \Magento\Framework\App\ObjectManager::getInstance()->get('Application\Blog\Model\JournalWarmPreference');
                if (!$warm instanceof \Application\Blog\Model\JournalPreferenceProbe) throw new \RuntimeException('Warm-up preference did not resolve');
                if ($this->pluginSubject->warm() !== 'warm-plugin') throw new \RuntimeException('Warm-up plugin did not execute');
                $counter = new \Magento\Framework\DataObject(['hits' => 0]);
                $this->events->dispatch('magelens_journal_warmup', ['counter' => $counter]);
                $preview = htmlspecialchars((string) $this->config->getValue($path . 'unused'), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                return $this->raw->create()
                    ->setHeader('Content-Type', 'text/html; charset=UTF-8', true)
                    ->setHeader('Cache-Control', 'no-store', true)
                    ->setContents('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Journal preview</title></head><body><p>' . $preview . '</p><p>Observer calls: ' . (int) $counter->getData('hits') . '</p></body></html>');
            case 'value-reads':
                $result['empty'] = $this->config->getValue($path . 'empty');
                $result['enabled'] = $this->config->isSetFlag($path . 'enabled');
                $result['multiline'] = $this->config->getValue($path . 'multiline');
                break;
            case 'missing-read': $result['missing'] = $this->config->getValue($path . 'missing'); break;
            case 'subtree-read': $result['data'] = $this->config->getValue('application_blog/subtree'); break;
            case 'database-override': $result['overridden'] = $this->config->getValue($path . 'overridden', ...$scope); break;
            case 'default-read': case 'website-read': case 'website-inherits-default':
            case 'store-read': case 'store-inherits-website': case 'store-inherits-default':
                $result['heading'] = $this->config->getValue($path . 'heading', ...$scope);
                if ($scope[0] !== 'default') {
                    $entity = str_starts_with($scope[0], 'store') ? $this->stores->getStore($scope[1]) : $this->stores->getWebsite($scope[1]);
                    $result['numeric'] = $this->config->getValue($path . 'heading', $scope[0], (int) $entity->getId());
                    $result['object'] = $this->config->getValue($path . 'heading', $scope[0], $entity);
                    if (str_starts_with($scope[0], 'store')) {
                        $this->stores->setCurrentStore($entity);
                        $result['current'] = $this->config->getValue($path . 'heading', 'store');
                    }
                }
                break;
            default: throw new \InvalidArgumentException('Unknown XML acceptance case');
        }
        return $this->json->create()->setData((object) $result);
    }
}
