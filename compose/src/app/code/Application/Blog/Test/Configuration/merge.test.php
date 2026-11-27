<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

// Run against the installed platform's real initial reader, merger and converter.
require '/var/www/html/app/bootstrap.php';
require '/application/docker/php/xml-data.php';
use MageLens\XmlCoverage\Xml;
$om = \Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$reader = $om->get(\Magento\Framework\App\Config\Initial\Reader::class);
$read = static function (array $sources) use ($reader) {
    $copy = clone $reader;
    (new ReflectionProperty($copy, '_scopePriorityScheme'))->setValue($copy, ['global']);
    (new ReflectionProperty($copy, '_fileResolver'))->setValue($copy, new class($sources) implements \Magento\Framework\Config\FileResolverInterface {
        public function __construct(private array $sources) {}
        public function get($filename, $scope = null) { return $this->sources; }
    });
    return $copy->read()['data']['default']['journal']['title'];
};
$shapes = [
    'text' => '%s', 'text-comment' => '%s<!-- explanation -->', 'comment-text' => '<!-- explanation -->%s',
    'cdata' => '<![CDATA[%s]]>', 'spaced-cdata' => "\n<![CDATA[%s]]>\n",
    'cdata-comment' => '<![CDATA[%s]]><!-- explanation -->', 'comment-cdata' => '<!-- explanation --><![CDATA[%s]]>',
    'text-cdata' => '%1$s<![CDATA[%1$s]]>', 'cdata-text' => '<![CDATA[%1$s]]>%1$s',
    'two-cdata' => '<![CDATA[%1$s]]><![CDATA[%1$s]]>', 'split-cdata' => '<![CDATA[%1$s]]><!-- split --><![CDATA[%1$s]]>', 'whitespace' => ' ',
    'comment-only' => '<!-- explanation -->', 'empty-cdata' => '<![CDATA[]]>', 'empty' => ''
];
$node = '/config/default/journal/title';
$one = hash('sha256', 'one'); $two = hash('sha256', 'two');
$known = ['one.xml' => [$node => $one], 'two.xml' => [$node => $two]];
$wrap = static fn($value) => '<config><default><journal><title>' . $value . '</title></journal></default></config>';
$checked = 0;
foreach ($shapes as $first => $left) foreach ($shapes as $second => $right) {
    $sources = ['one.xml' => $wrap(sprintf($left, 'old')), 'two.xml' => $wrap(sprintf($right, 'new'))];
    $originals = $sources;
    $actual = $read($sources);
    $symbolic = Xml::symbolicSources($sources, $known);
    $origin = $read($symbolic['sources']);
    if (isset($symbolic['unmeasured'][$node])) {
        if ($origin !== $actual) throw new RuntimeException("Unmeasured input changed for $first/$second");
    } else {
        $expected = match (true) {
            is_string($actual) && str_contains($actual, 'old') && !str_contains($actual, 'new') => $one,
            is_string($actual) && str_contains($actual, 'new') && !str_contains($actual, 'old') => $two,
            $actual === null => $second === 'whitespace' ? $two : $one,
            default => throw new RuntimeException("Unexpected scalar for $first/$second")
        };
        if ($origin !== $expected) throw new RuntimeException("Wrong XML origin for $first/$second");
    }
    if ($sources !== $originals) throw new RuntimeException('Original XML source bytes changed');
    $checked++;
}
// A unique empty default remains measurable; adding a marker cannot affect a
// competing merge branch because no other declaration supplies this path.
$single = Xml::symbolicSources(['one.xml' => $wrap('')], $known);
if ($single['unmeasured'] || $read($single['sources']) !== $one) throw new RuntimeException('Unique empty default lost its origin');
foreach (['', ' '] as $empty) {
    $sources = ['one.xml' => $wrap($empty), 'two.xml' => $wrap('<child>new</child>')];
    $withChild = $known; $withChild['two.xml'][$node . '/child'] = $two;
    $symbolic = Xml::symbolicSources($sources, $withChild);
    if (!isset($symbolic['unmeasured'][$node]) || $read($sources) !== ['child' => 'new']
        || $read($symbolic['sources']) !== ['child' => $two]) throw new RuntimeException('Empty-to-subtree merge semantics changed');
}
echo "Real XML merger: $checked text/comment/CDATA combinations and unique empty defaults passed.\n";
