<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Names;

use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\App\RequestInterface;
use Magento\Framework\Controller\Result\Raw;
use Magento\Framework\Controller\Result\RawFactory;
use Magento\Framework\View\Result\LayoutFactory;

class Index implements HttpGetActionInterface
{
    public function __construct(private LayoutFactory $layouts, private RawFactory $raw, private RequestInterface $request) {}
    public function execute(): Raw
    {
        $case = $this->request->getParam('case');
        $containers = $case === 'containers';
        $move = $case === 'move';
        $fragment = $this->layouts->create();
        $handles = $containers ? ['coverageprobe_names_containers'] : ['coverageprobe_names_base', 'coverageprobe_names_overlay'];
        if ($move) $handles[] = 'coverageprobe_names_move';
        $fragment->addHandle($handles);
        $layout = $fragment->getLayout();
        $staleCount = 0;
        if ($containers) {
            $block = $layout->getBlock('numeric.container.child');
            $parent = $layout->getParentName('numeric.container.child');
            if (!$block || !is_string($parent) || $parent === '0' || $parent === ''
                || $layout->getElementProperty($parent, 'htmlId') !== 'layout-zero-container') throw new \RuntimeException('Native zero container naming changed');
            $outputs = (new \ReflectionProperty(\Magento\Framework\View\Layout::class, '_output'))->getRawValue($layout);
            $stale = array_values(array_filter($outputs, static fn($name) => !$layout->hasElement($name)));
            $staleCount = count($stale);
            if ($staleCount > 1) throw new \RuntimeException('Native anonymous root output count exceeded the fixture bound');
            if ($stale) {
                $failed = false;
                try { $layout->getOutput(); }
                catch (\OutOfBoundsException $error) {
                    if (!str_contains($error->getMessage(), '"' . $stale[0] . '" ID')) throw $error;
                    $failed = true;
                }
                if (!$failed) throw new \RuntimeException('Native stale anonymous output failure was not reproduced');
                foreach ($stale as $name) $layout->removeOutputElement($name);
            }

        } else {
            $blocks = [];
            $dangling = [];
            foreach ($layout->getChildNames('300') as $name) {
                $block = $layout->getBlock($name);
                if (!$block) { $dangling[] = $name; continue; }
                $label = $block->getData('numeric_case');
                if (isset($blocks[$label])) throw new \RuntimeException('Native numeric case repeated');
                $blocks[$label] = $block;
            }
            $integer = $layout->getBlock('123');
            $leading = $layout->getBlock('00123');
            $moved = $layout->getBlock('124');
            if (!$integer || !$leading || !$moved || $integer->getNameInLayout() !== 123
                || $leading->getNameInLayout() !== '00123' || $moved->getNameInLayout() !== 124
                || $integer->getTemplate() !== 'MageLens_Compatibility::layout-names-override.phtml'
                || array_keys($blocks) !== ['leading', 'zero', 'anonymous']
                || $dangling !== ($move ? [0, 1] : [0])
                || (string) $layout->getParentName('124') !== ($move ? '300' : '400')
                || ($move && $layout->getChildName('300', 'moved') !== 1)) {
                throw new \RuntimeException('Native numeric names or reindexing changed: ' . json_encode([
                    'visible' => array_keys($blocks), 'dangling' => $dangling,
                    'children' => $layout->getChildNames('300'), 'alias' => $layout->getChildName('300', 'moved'),
                ]));
            }
            foreach (['zero', 'anonymous'] as $label) {
                $name = $blocks[$label]->getNameInLayout();
                if (!is_string($name) || $name === '' || $name === '0' || $layout->getBlock($name) !== $blocks[$label]) {
                    throw new \RuntimeException('Native anonymous block naming changed');
                }
            }
        }
        if (!$containers) {
            $failed = false;
            try { $layout->getOutput(); }
            catch (\OutOfBoundsException $error) {
                if (!str_contains($error->getMessage(), '"0" ID')) throw $error;
                $failed = true;
            }
            if (!$failed) throw new \RuntimeException('Native numeric child failure was not reproduced');
            $layout->removeOutputElement('300');
            if (!$move) {
                $failed = false;
                try { $layout->getOutput(); }
                catch (\OutOfBoundsException $error) {
                    if (!str_contains($error->getMessage(), '"0" ID')) throw $error;
                    $failed = true;
                }
                if (!$failed) throw new \RuntimeException('Native automatic root output unexpectedly changed');
            }
            $layout->removeOutputElement('400');
            $layout->addOutputElement($move ? 123 : '123');
            foreach ($blocks as $block) $layout->addOutputElement($block->getNameInLayout());
            if ($move) $layout->addOutputElement('124');
        }
        $html = $layout->getOutput();
        if (substr_count($html, 'data-layout-name-case=') !== ($containers ? 1 : ($move ? 5 : 4))
            || ($containers ? !str_contains($html, 'id="layout-zero-container"') : str_contains($html, 'id="layout-numeric-root"'))) {
            throw new \RuntimeException('Native numeric names output changed');
        }
        if (!$containers) $html .= '<span data-layout-name-render-failed>verified</span>';
        return $this->raw->create()->setContents($html . '<span data-layout-name-stale-roots="' . $staleCount . '">verified</span><span data-layout-name-proof>verified</span>');
    }
}
