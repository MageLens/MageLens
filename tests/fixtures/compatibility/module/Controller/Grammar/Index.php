<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Grammar;

use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\App\ViewInterface;
use Magento\Framework\Controller\Result\Raw;
use Magento\Framework\Controller\Result\RawFactory;
use Magento\Framework\View\Result\PageFactory;

class Index implements HttpGetActionInterface
{
    public function __construct(private PageFactory $pages, private RawFactory $raw, ViewInterface $view)
    {
    }

    public function execute(): Raw
    {
        $output = '';
        foreach (['serviceurl', 'const', 'configurable', 'configuredarray', 'constarray', 'updaterenabled', 'updaterorder'] as $case) {
            $page = $this->pages->create(true, ['isIsolated' => true]);
            $page->addHandle('coverageprobe_grammar_' . $case);
            $outcome = 'unexpected';
            try {
                $block = $page->getLayout()->getBlock('magelens.layout.grammar.' . $case);
                $value = $block?->getData('value');
                if ($case === 'const' && $value === PHP_INT_MAX) $outcome = 'applied';
                if ($case === 'constarray' && $value === \MageLens\Compatibility\Model\LayoutArgumentSource::MATRIX) $outcome = 'applied';
                if ($case === 'serviceurl' && is_string($value)
                    && str_ends_with((string) parse_url($value, PHP_URL_PATH), '/rest/default/V1/coverageprobe/fragment/index')
                    && parse_url($value, PHP_URL_QUERY) === null) $outcome = 'applied';
            } catch (\Error $error) {
                if ($case === 'configurable'
                    && $error->getMessage() === 'Cannot use object of type MageLens\Compatibility\Model\LayoutArgumentSource as array') {
                    $outcome = 'generator-error';
                } elseif ($case === 'configuredarray' && $error instanceof \TypeError
                    && str_starts_with($error->getMessage(),
                        'Magento\Framework\Data\Argument\Interpreter\Composite::evaluate(): Argument #1 ($data) must be of type array, string given')
                    && ($error->getTrace()[0]['class'] ?? null) === \Magento\Framework\Data\Argument\Interpreter\Composite::class
                    && basename($error->getTrace()[0]['file'] ?? '') === 'ConfigurableObject.php') {
                    $outcome = 'nested-interpreter-error';
                } elseif (in_array($case, ['updaterenabled', 'updaterorder'], true) && $error instanceof \TypeError
                    && $error->getMessage() === 'ltrim(): Argument #1 ($string) must be of type string, array given') {
                    $outcome = 'updater-lookup-error';
                } else throw $error;
            }
            $output .= '<span data-layout-grammar="' . $case . '">' . $outcome . '</span>';
        }
        foreach (['cachefalse' => false, 'cacheremoved' => true, 'cachezero' => true] as $case => $expected) {
            $page = $this->pages->create(true, ['isIsolated' => true]);
            $page->addHandle('coverageprobe_grammar_' . $case);
            $observed = $page->getLayout()->isCacheable();
            $output .= '<span data-layout-grammar="' . $case . '">' . ($observed === $expected ? 'verified' : 'unexpected') . '</span>';
        }
        return $this->raw->create()->setContents($output);
    }
}
