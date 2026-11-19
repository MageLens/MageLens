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
use MageLens\XmlCoverage\{LayoutCoverage, LayoutManifest, LayoutRuntimeHooks};
$case = $argv[1] ?? 'array-access';
if (!in_array($case, ['array-access', 'object-error'], true)) throw new RuntimeException('Unknown argument storage case');
$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_names_containers.xml';
$source = file_get_contents(BP . '/' . $path);
$files = [['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
    'declarations' => LayoutManifest::declarations($path, $source)]];
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
if (!in_array('--without-collector', $argv, true)) foreach ($callbacks as [$class, $method, $pre, $post]) {
    $registered = class_exists(LayoutRuntimeHooks::class) ? LayoutRuntimeHooks::register($class, $method, $pre, $post)
        : \MageLens\XmlCoverage\LayoutRuntimeHooks::register($class, $method, $pre, $post);
    if (!$registered) throw new RuntimeException('Cannot register argument storage proof');
}
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend')->load(Magento\Framework\App\Area::PART_CONFIG);
$value = $case === 'object-error' ? new stdClass() : new class implements ArrayAccess {
    public int $reads = 0;
    public function offsetExists(mixed $offset): bool { $this->reads++; return false; }
    public function offsetGet(mixed $offset): mixed { throw new LogicException('Native argument offset read changed'); }
    public function offsetSet(mixed $offset, mixed $value): void { throw new LogicException('Argument storage was written'); }
    public function offsetUnset(mixed $offset): void { throw new LogicException('Argument storage was unset'); }
};
$generator = $objects->get(Magento\Framework\View\Layout\Generator\Block::class);
$failed = false;
try {
    $result = (new ReflectionMethod($generator, 'evaluateArguments'))->invoke($generator, ['value' => $value]);
    if ($case !== 'array-access' || $result !== ['value' => $value]) throw new RuntimeException('Native argument passthrough changed');
} catch (Error $error) {
    if ($case !== 'object-error' || $error->getMessage() !== 'Cannot use object of type stdClass as array') throw $error;
    $failed = true;
}
if ($failed !== ($case === 'object-error')) throw new RuntimeException('Expected native argument failure is missing');
echo "Verified native argument storage effect: $case.\n";
if ($case === 'array-access' && $value->reads !== 1) throw new RuntimeException('Collection added an application argument offset probe');
if (!in_array('--without-collector', $argv, true)) {
    $collector->finish();
    if ((new ReflectionProperty(MageLens\XmlCoverage\Recorder::class, 'events'))->getValue() !== []) {
        throw new RuntimeException('Unmapped raw argument storage received original XML credit');
    }
}
echo "Verified passive argument inspection preserves native reads and expected failures.\n";
