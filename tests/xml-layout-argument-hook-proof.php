<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

require '/var/www/html/app/bootstrap.php';
$hooks = dirname(getenv('MAGELENS_XML_HOOKS') ?: __DIR__ . '/../docker/php/xml-hooks.php');
require $hooks . '/xml-hooks.php';
require $hooks . '/xml-layout-manifest.php';

use MageLens\XmlCoverage\{LayoutCoverage, LayoutManifest, Recorder};
use Magento\Framework\Data\Argument\Interpreter\Composite;
use Magento\Framework\View\Layout\Reader\Block as BlockReader;
use Magento\Framework\View\Layout\Generator\Block as BlockGenerator;

$mode = $argv[1] ?? 'native';
if (!in_array($mode, ['native', 'reader', 'generator', 'missing-interpreter', 'missing-reader', 'missing-generator', 'missing-action', 'batch-depth', 'interpreter-depth', 'action-depth', 'argument-limit'], true)) throw new RuntimeException('Unknown argument proof mode');
$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_interpreter_index.xml';
$source = file_get_contents(BP . '/' . $path);
$declarations = LayoutManifest::declarations($path, $source);
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets([
    ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source), 'declarations' => $declarations],
]));
if (in_array($mode, ['batch-depth', 'interpreter-depth'], true)) {
    $ownership = (new ReflectionProperty(LayoutCoverage::class, 'argumentOwnership'))->getValue($collector);
    $frame = $mode === 'batch-depth' ? ['owner' => new stdClass(), 'reader' => false, 'queue' => [],
        'next' => 0, 'unconfirmed' => [], 'depth' => 0] : null;
    (new ReflectionProperty(\MageLens\XmlCoverage\LayoutArgumentOwnership::class,
        $mode === 'batch-depth' ? 'batches' : 'evaluating'))->setValue($ownership, array_fill(0, 256, $frame));
}
$warnings = 0;
if ($mode === 'interpreter-depth') {
    set_error_handler(static function (int $severity) use (&$warnings): bool {
        if (error_reporting() & $severity) $warnings++;
        return false;
    });
}
if ($mode === 'action-depth') {
    (new ReflectionProperty(LayoutCoverage::class, 'actionEvaluations'))->setValue($collector, array_fill(0, 256, null));
}
foreach ($callbacks as [$class, $method, $pre, $post]) {
    $missing = ['missing-interpreter' => [\Magento\Framework\Data\Argument\InterpreterInterface::class, 'evaluate'],
        'missing-reader' => [BlockReader::class, 'evaluateArguments'],
        'missing-generator' => [BlockGenerator::class, 'evaluateArguments'],
        'missing-action' => [BlockGenerator::class, 'generateAction']][$mode] ?? null;
    if ($missing === [$class, $method]) continue;
    if (!\OpenTelemetry\Instrumentation\hook($class, $method, $pre, $post)) throw new RuntimeException('Cannot register argument proof hook');
}
$manager = \Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$manager->get(\Magento\Framework\App\State::class)->setAreaCode('frontend');
$manager->get(\Magento\Framework\App\AreaList::class)->getArea('frontend')->load(\Magento\Framework\App\Area::PART_CONFIG);
$manager->get(\Magento\Framework\App\AreaList::class)->getArea('frontend')->load(\Magento\Framework\App\Area::PART_DESIGN);
$cacheState = $manager->get(\Magento\Framework\App\Cache\StateInterface::class);
foreach (['layout', 'block_html', 'full_page'] as $type) $cacheState->setEnabled($type, false);
$manager->get(\Magento\Framework\App\ViewInterface::class);
$page = $manager->get(\Magento\Framework\View\Result\PageFactory::class)->create(true, ['isIsolated' => true]);
$page->addHandle('coverageprobe_interpreter_index');
$replace = static function ($composite, string $type): void {
    $property = new ReflectionProperty(Composite::class, 'interpreters');
    $interpreters = $property->getValue($composite);
    $interpreters[$type] = new \MageLens\Compatibility\Model\LayoutValueInterpreter();
    $property->setValue($composite, $interpreters);
};
if ($mode === 'reader') {
    \OpenTelemetry\Instrumentation\hook(BlockReader::class, 'evaluateArguments',
        static function ($reader, array $params) use ($replace): void {
            if ($params[0]->getAttribute('name') !== 'magelens.layout.interpreter') return;
            $interpreter = (new ReflectionProperty(BlockReader::class, 'argumentInterpreter'))->getValue($reader);
            $replace($interpreter, 'string');
        });
}
if ($mode === 'generator') {
    $pool = (new ReflectionProperty(\Magento\Framework\View\Layout::class, 'generatorPool'))->getValue($page->getLayout());
    $interpreter = (new ReflectionProperty(BlockGenerator::class, 'argumentInterpreter'))->getValue($pool->getGenerator('block'));
    $composite = (new ReflectionProperty(\Magento\Framework\View\Layout\Argument\Interpreter\Decorator\Updater::class, 'subject'))->getValue($interpreter);
    $replace($composite, 'helper');
}
if ($mode === 'argument-limit') {
    $update = $page->getLayout()->getUpdate();
    $update->load();
    $arguments = '';
    for ($index = 0; $index < 1025; $index++) {
        $arguments .= '<argument name="limit' . $index . '" xsi:type="string">fixture</argument>';
    }
    $update->addUpdate('<body><referenceBlock name="magelens.layout.interpreter"><arguments>' . $arguments . '</arguments></referenceBlock></body>');
}
$block = $page->getLayout()->getBlock('magelens.layout.interpreter');
if (!str_contains($block->toHtml(), 'data-layout-mutation>xml-value</span>')
    || $block->getData('late') !== 'xml-value'
    || $block->getData('action_value') !== 'xml-value'
    || $block->getData('nested') !== ['changed' => 'xml-value', 'surviving' => 'xml-value']) {
    throw new RuntimeException('Native custom interpretation changed fixture values');
}
if (in_array($mode, ['reader', 'generator'], true) && \MageLens\Compatibility\Model\LayoutValueInterpreter::$calls < 2) {
    throw new RuntimeException('Native custom interpreter path was bypassed');
}
if ($warnings) throw new RuntimeException('Argument observation emitted warnings at its depth bound');
try {
    $collector->finish();
    if (str_starts_with($mode, 'missing-')) throw new LogicException('Missing argument observation was accepted');
} catch (RuntimeException $error) {
    $expected = ['missing-interpreter' => 'Missing native layout argument interpreter hook evidence',
        'missing-reader' => 'Missing native layout reader argument batch hook evidence',
        'missing-generator' => 'Missing native layout generator argument batch hook evidence',
        'missing-action' => 'Missing native layout action hook evidence',
        'batch-depth' => 'Layout argument batch nesting exceeded 256 calls',
        'interpreter-depth' => 'Layout interpreter nesting exceeded 256 calls',
        'argument-limit' => 'Layout argument batch exceeded 1024 values',
        'action-depth' => 'Layout action evaluation nesting exceeded 256 calls'][$mode] ?? null;
    if (!$expected || !str_contains($error->getMessage(), $expected)) throw $error;
    echo "Verified native argument publication guard for $mode.\n";
    exit;
}
$events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
foreach ($declarations as $declaration) {
    if ($declaration['layout']['kind'] === 'action') {
        $effects = array_column(array_filter($events, static fn($event) => $event['id'] === $declaration['id']), 'type');
        if ($effects !== ['layout-action-executed']) throw new RuntimeException('Native action lost its independent call origin');
        continue;
    }
    if (!in_array($declaration['layout']['kind'], ['argument', 'action-argument'], true)) continue;
    $name = $declaration['layout']['element'];
    $effects = array_values(array_unique(array_column(array_filter($events,
        static fn($event) => $event['id'] === $declaration['id']), 'type')));
    $action = $declaration['layout']['kind'] === 'action-argument';
    $affected = $action ? $mode === 'generator' && $name === 'value'
        : ($mode === 'reader' ? $name !== 'value' : ($mode === 'generator' && $name !== 'late'));
    if ($affected) {
        if ($effects !== ['layout-argument-origin-unconfirmed']) throw new RuntimeException('Custom interpretation retained XML argument ownership for ' . $declaration['node']);
    } elseif (!in_array($action ? 'layout-action-argument-applied' : 'layout-argument-applied', $effects, true)) {
        throw new RuntimeException('Native argument lost independently attributable application for ' . $declaration['node']);
    }
}
echo "Verified native argument ownership boundary for $mode.\n";
