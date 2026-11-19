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
use Magento\Framework\View\File\FileList;

class LayoutFileListGetter extends FileList
{
    public static int $reads = 0;
    protected $files = [] {
        &get {
            self::$reads++;
            return $this->files;
        }
    }
}
class LayoutFileListMagic extends FileList
{
    public static int $reads = 0;
    private array $stored = [];
    public function __construct(Magento\Framework\View\File\FileList\CollateInterface $collator)
    {
        parent::__construct($collator);
        unset($this->files);
    }
    public function &__get($name)
    {
        if ($name !== 'files') throw new RuntimeException('Unexpected file-list magic getter');
        self::$reads++;
        return $this->stored;
    }
    public function __set($name, $value)
    {
        if ($name !== 'files') throw new RuntimeException('Unexpected file-list magic setter');
        $this->stored = $value;
    }
}
$mode = $argv[1] ?? 'hook';
if (!in_array($mode, ['native', 'hook', 'magic'], true)) throw new RuntimeException('Unknown file list proof mode');
$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_templateownership_native.xml';
$source = file_get_contents(BP . '/' . $path);
$declarations = LayoutManifest::declarations($path, $source);
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets([
    ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source), 'declarations' => $declarations],
]));
foreach ($callbacks as [$class, $method, $pre, $post]) {
    if (in_array('--without-collector', $argv, true)) continue;
    if (!OpenTelemetry\Instrumentation\hook($class, $method, $pre, $post)) throw new RuntimeException('Cannot register file list proof hook');
}
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
$area->load(Magento\Framework\App\Area::PART_CONFIG);
$area->load(Magento\Framework\App\Area::PART_DESIGN);
$counter = $mode === 'magic' ? LayoutFileListMagic::class : LayoutFileListGetter::class;
if ($mode !== 'native') $objects->configure(['preferences' => [FileList::class => $counter]]);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$objects->get(Magento\Framework\App\ViewInterface::class);
$page = $objects->get(Magento\Framework\View\Result\PageFactory::class)->create(true, ['isIsolated' => true]);
$page->addHandle('coverageprobe_templateownership_native');
$block = $page->getLayout()->getBlock('magelens.layout.template.native');
if (!str_contains($block->toHtml(), 'data-layout-mutation>xml-value</span>')) throw new RuntimeException('Native file-list fixture output changed');
if ($mode !== 'native' && $counter::$reads === 0) throw new RuntimeException('Native file-list getter was not used');
echo "Verified native layout file collection and template output for $mode.\n";
echo 'Native file-list reads: ', $counter::$reads, "\n";
if (in_array('--without-collector', $argv, true)) exit;
$expected = array_search('--expected-reads', $argv, true);
if ($expected !== false && $counter::$reads !== (int) $argv[$expected + 1]) throw new RuntimeException('Collector invoked extra native file-list getters');
[, , $limits] = $collector->finish();
if (in_array('layout-file-replacement-storage-unconfirmed', $limits, true) !== ($mode !== 'native')) {
    throw new RuntimeException('File replacement storage ownership limitation differs');
}
$item = array_values(array_filter($declarations, static fn($item) => $item['layout']['kind'] === 'template'))[0];
$events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
$types = array_values(array_unique(array_column(array_filter($events, static fn($event) => $event['id'] === $item['id']), 'type')));
sort($types);
if ($types !== ['layout-template-executed', 'layout-template-selected']) throw new RuntimeException('Independent native file-read/template provenance was lost');
echo "Verified passive file-list storage limits and independent original file-read/template evidence.\n";
