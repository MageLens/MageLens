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

use MageLens\XmlCoverage\{LayoutCoverage, LayoutManifest, LayoutRuntimeHooks, Recorder};

class MageLensCustomParameterString extends Magento\Framework\Data\Argument\Interpreter\BaseStringUtils
{
    public function evaluate(array $data) { return parent::evaluate($data); }
}
$customParameterString = in_array('--custom-parameter-string', $argv, true);
$paths = [
    'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_nestedarguments.xml',
    'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_named_parameter_overlay.xml',
    'app/code/MageLens/LayoutOverlay/view/frontend/layout/coverageprobe_named_parameter_overlay.xml',
];
$files = [];
foreach ($paths as $path) {
    $source = file_get_contents(BP . '/' . $path);
    $files[] = ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
        'declarations' => LayoutManifest::declarations($path, $source)];
}
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
$missingParameter = array_values(array_filter($argv, static fn($value) => str_starts_with($value, '--missing-parameter-')))[0] ?? null;
$skipParameter = static function ($interpreter) use ($missingParameter): bool {
    if ($missingParameter === null) return false;
    if (str_contains($missingParameter, '-map-')) return $interpreter instanceof Magento\Framework\View\Layout\Argument\Interpreter\NamedParams;
    $baseOnly = str_contains($missingParameter, '-string-');
    if (!$interpreter instanceof Magento\Framework\Data\Argument\Interpreter\StringUtils
        && !$interpreter instanceof Magento\Framework\Data\Argument\Interpreter\BaseStringUtils) return false;
    if ($baseOnly && !$interpreter instanceof Magento\Framework\Data\Argument\Interpreter\BaseStringUtils) return false;
    foreach (LayoutRuntimeHooks::trace(DEBUG_BACKTRACE_IGNORE_ARGS, 8) as $call) {
        if (($call['class'] ?? null) === Magento\Framework\View\Layout\Argument\Interpreter\NamedParams::class
            && ($call['function'] ?? null) === 'evaluate') return true;
    }
    return false;
};
if (!in_array('--without-collector', $argv, true)) foreach ($callbacks as [$class, $method, $pre, $post]) {
    if ($class === Magento\Framework\Data\Argument\InterpreterInterface::class && $method === 'evaluate' && $missingParameter !== null) {
        if (!str_ends_with($missingParameter, '-post')) {
            $original = $pre;
            $pre = static function ($interpreter, ...$params) use ($original, $skipParameter): void {
                if (!$skipParameter($interpreter)) $original($interpreter, ...$params);
            };
        }
        if (!str_ends_with($missingParameter, '-pre')) {
            $original = $post;
            $post = static function ($interpreter, ...$params) use ($original, $skipParameter): void {
                if (!$skipParameter($interpreter)) $original($interpreter, ...$params);
            };
        }
    }
    if (!LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot observe nested modifier fixture');
}
$nativeParameters = [];
if (in_array('--parameters', $argv, true) && !LayoutRuntimeHooks::register(
    Magento\Framework\View\Layout\Argument\Interpreter\NamedParams::class, 'evaluate', null,
    static function ($interpreter, array $params, $result, ?Throwable $error) use (&$nativeParameters): void {
        if (!$error && ($result === ['first' => 'nested', 'second' => 'helper'] || $result === ['variant' => 'nested']
            || $result === ['left' => 'action', 'right' => 'parameter'] || $result === [0 => 'equal', 'second' => 'retained'] || $result === ['first' => 'winner', '' => ''])) {
            $nativeParameters[] = $result;
        }
    })) throw new RuntimeException('Cannot observe native parameter map assignment');
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
foreach ([Magento\Framework\App\Area::PART_CONFIG, Magento\Framework\App\Area::PART_DESIGN] as $part) $area->load($part);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$namedInterpreter = null;
$previousString = null;
$parameterSlot = new ReflectionProperty(Magento\Framework\View\Layout\Argument\Interpreter\NamedParams::class, 'paramInterpreter');
if ($customParameterString) {
    $namedInterpreter = $objects->get(Magento\Framework\View\Layout\Argument\Interpreter\NamedParams::class);
    $previousString = $parameterSlot->getRawValue($namedInterpreter);
    $replacement = clone $previousString;
    (new ReflectionProperty(Magento\Framework\Data\Argument\Interpreter\StringUtils::class, 'baseStringUtils'))
        ->setRawValue($replacement, new MageLensCustomParameterString($objects->get(Magento\Framework\Stdlib\BooleanUtils::class)));
    $parameterSlot->setRawValue($namedInterpreter, $replacement);
}
try {
    $result = $objects->create(MageLens\Compatibility\Controller\Nestedarguments\Index::class)->execute();
} finally {
    if ($namedInterpreter !== null) $parameterSlot->setRawValue($namedInterpreter, $previousString);
}
$html = (new ReflectionProperty(Magento\Framework\Controller\Result\Raw::class, 'contents'))->getRawValue($result);
if (substr_count($html, '<span data-layout-nested-argument=') !== 6 || !str_contains($html, 'data-layout-named-overlay>verified</span>')) throw new RuntimeException('Expected six native nested modifier outcomes');
foreach ($files as $file) {
    if (hash_file('sha256', BP . '/' . $file['path']) !== $file['sourceHash']) throw new RuntimeException('Nested fixture source changed');
}
echo "Verified native nested lifetimes, translation flags, model/helper/URL values and ignored group.\n";
if (in_array('--parameters', $argv, true)) {
    if ($nativeParameters !== [['first' => 'nested', 'second' => 'helper'], ['variant' => 'nested'],
        [0 => 'equal', 'second' => 'retained'], ['first' => 'winner', '' => ''], ['left' => 'action', 'right' => 'parameter']]) {
        throw new RuntimeException('Native helper/URL parameter map assignment changed: ' . json_encode($nativeParameters, JSON_THROW_ON_ERROR));
    }
    echo "Verified native helper/URL parameter names and values through real fragment construction.\n";
}
if (in_array('--without-collector', $argv, true)) exit;
try {
    $state = $collector->finish();
    if ($missingParameter !== null) throw new LogicException('Missing parameter observer did not block publication');
} catch (RuntimeException $error) {
    if ($missingParameter === null || !preg_match('/Missing native layout (?:named parameter|parameter|argument)|Unbalanced layout|Layout runtime hook callback failed/', $error->getMessage())) throw $error;
    echo "Native parameter values survive missing observer evidence; publication is rejected.\n";
    exit;
}
$events = array_values((new ReflectionProperty(Recorder::class, 'events'))->getValue());
$counts = [0, 0];
foreach ($files[0]['declarations'] as $declaration) {
    if (!in_array($declaration['layout']['kind'], ['argument-shared', 'argument-translate', 'argument-model', 'argument-helper', 'argument-path'], true)) continue;
    $ignored = str_contains($declaration['node'], '/arguments[2]/');
    $counts[(int) $ignored]++;
    $effects = array_column(array_filter($events, static fn($event) => $event['id'] === $declaration['id']), 'type');
    if ($ignored ? $effects !== ['layout-argument-group-ignored'] : !in_array('layout-argument-modifier-evaluated', $effects, true)) {
        throw new RuntimeException('Original nested modifier lacks exact native evidence: ' . $declaration['node'] . ': ' . implode(', ', $effects));
    }
}
if ($counts !== [9, 5]) throw new RuntimeException('Original nested modifier inventory changed');
echo "Verified nine evaluated nested fields and five ignored nested fields independently.\n";
if (in_array('--parameters', $argv, true)) {
    $counts = [0, 0];
    foreach ($files[0]['declarations'] as $declaration) {
        if ($declaration['layout']['instruction'] !== 'param') continue;
        $ignored = str_contains($declaration['node'], '/arguments[2]/');
        $counts[(int) $ignored]++;
        $effects = array_column(array_filter($events, static fn($event) => $event['id'] === $declaration['id']), 'type');
        $expected = $declaration['layout']['attribute'] === 'name' ? 'layout-parameter-name-applied'
            : ($customParameterString ? 'layout-parameter-origin-unconfirmed' : 'layout-parameter-evaluated');
        if (!$ignored && $customParameterString && $declaration['layout']['attribute'] === null
            && in_array('layout-parameter-evaluated', $effects, true)) throw new RuntimeException('Custom parameter evaluator retained XML value evaluation credit');
        if ($ignored ? $effects !== ['layout-argument-group-ignored'] : !in_array($expected, $effects, true)) {
            throw new RuntimeException('Original named parameter lacks independent evidence: ' . $declaration['node']);
        }
    }
    if ($counts !== [6, 4]) throw new RuntimeException('Original named parameter inventory changed');
    echo "Verified three applied parameter values/names and two ignored parameter values/names.\n";
    $winning = [
        [['replaced', 'replaced'], ['evaluated', 'replaced'], ['replaced', 'replaced'], ['evaluated', 'applied'], ['evaluated', 'applied'], ['evaluated', 'applied'], ['evaluated', 'applied'], [null, null], [null, null]],
        [['evaluated', 'applied'], ['value-inherited', 'applied']],
    ];
    foreach (array_slice($files, 1) as $fileIndex => $file) {
        $parameters = array_values(array_filter($file['declarations'], static fn($item) => $item['layout']['instruction'] === 'param'));
        if (count($parameters) !== count($winning[$fileIndex]) * 2) throw new RuntimeException('Overlay parameter inventory changed');
        foreach ($parameters as $index => $parameter) {
            $decision = $winning[$fileIndex][intdiv($index, 2)][$index % 2];
            if ($customParameterString && $decision === 'evaluated') $decision = 'origin-unconfirmed';
            $expected = 'layout-parameter-' . match ($decision) {
                'replaced' => 'overridden', 'applied' => 'name-applied', default => $decision
            };
            $actual = array_column(array_filter($events, static fn($event) => $event['id'] === $parameter['id']), 'type');
            if ($actual !== ($decision === null ? [] : [$expected])) throw new RuntimeException('Exact overlay parameter owner differs at ' . $parameter['node']
                . ': expected ' . $expected . ', got ' . implode(', ', $actual));
        }
    }
    echo "Verified equal override, split name/value ownership, duplicates and empty/numeric names.\n";

}

$destination = array_search('--evidence-file', $argv, true);
if ($destination !== false) {
    $json = json_encode(['files' => $files, 'layoutSources' => LayoutManifest::targets($files), 'layoutHook' => $state[0],
        'layoutSourceTrace' => $state[1], 'layoutLimitations' => $state[2], 'events' => $events], JSON_THROW_ON_ERROR);
    if (file_put_contents($argv[$destination + 1], $json) !== strlen($json)) throw new RuntimeException('Cannot save bounded nested fixture evidence');
}
