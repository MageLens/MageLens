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
use Magento\Framework\View\Layout;
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
        $developer = (new \ReflectionProperty(Layout::class, 'appState'))->getRawValue($layout)->getMode()
            === \Magento\Framework\App\State::MODE_DEVELOPER;
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
                // Missing root display checks precede the native render catch.
                $partial = $this->observedOutput($layout, $stale, true);
                if ($partial !== '') throw new \RuntimeException('Native stale output suppression changed');
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
                || $layout->getChildNames('400') !== [0]
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
            // The missing child's display check aborts its parent container.
            // Reindexing also leaves a dangling child in the old move parent.
            $partial = $this->observedOutput($layout, ['0'], $developer, 2);
            if ($partial !== '') throw new \RuntimeException('Native failed numeric roots produced output');
            $layout->removeOutputElement('300');
            if (!$move) {
                $cached = $this->observedOutput($layout, $developer ? ['0'] : [], $developer);
                if ($cached !== '') throw new \RuntimeException('Native empty numeric root cache changed');
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
        if (!$containers) $html .= '<span data-layout-name-render-failed data-layout-name-render-outcome="' . ($developer ? 'thrown' : 'logged') . '">verified</span>';
        return $this->raw->create()->setContents($html . '<span data-layout-name-stale-roots="' . $staleCount . '">verified</span><span data-layout-name-proof>verified</span>');
    }

    private function observedOutput(Layout $layout, array $missing, bool $throws, int $repeats = 1): string
    {
        $property = new \ReflectionProperty(Layout::class, 'logger');
        $original = $property->getRawValue($layout);
        $probe = new class($original, $missing) extends \Psr\Log\AbstractLogger {
            public array $counts;
            public bool $unexpected = false;
            public function __construct(private \Psr\Log\LoggerInterface $delegate, private array $missing)
            {
                $this->counts = array_fill(0, count($missing), 0);
            }
            public function log($level, $message, array $context = []): void
            {
                if ($level === \Psr\Log\LogLevel::CRITICAL) {
                    $matched = false;
                    if ($message instanceof \OutOfBoundsException) foreach ($this->missing as $index => $name) {
                        if (str_contains($message->getMessage(), '"' . $name . '" ID')) {
                            $this->counts[$index]++; $matched = true; break;
                        }
                    }
                    if (!$matched) $this->unexpected = true;
                    $this->delegate->critical($message, $context);
                } else $this->delegate->log($level, $message, $context);
            }
        };
        $property->setRawValue($layout, $probe);
        $html = ''; $caught = false;
        try { $html = $layout->getOutput(); }
        catch (\OutOfBoundsException $error) {
            if (!$throws || !$missing || !str_contains($error->getMessage(), '"' . $missing[0] . '" ID')) throw $error;
            $caught = true;
        } finally { $property->setRawValue($layout, $original); }
        if ($caught !== $throws || $probe->unexpected
            || $probe->counts !== array_fill(0, count($missing), $throws ? 0 : $repeats)) {
            throw new \RuntimeException('Native numeric output exception/log boundary changed: ' . json_encode([
                'caught' => $caught, 'unexpected' => $probe->unexpected, 'counts' => $probe->counts,
            ]));
        }
        return $html;
    }
}
