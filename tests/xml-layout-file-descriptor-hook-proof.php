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


class LayoutFileRedeclared extends Magento\Framework\View\File
{
    public static int $reads = 0;
    protected $filename;
}
class LayoutFileAccessor extends Magento\Framework\View\File
{
    public static int $reads = 0;
    public function getFilename()
    {
        self::$reads++;
        return parent::getFilename();
    }
}
class LayoutFileProperty extends Magento\Framework\View\File
{
    public static int $reads = 0;
    protected $filename {
        get {
            self::$reads++;
            return $this->filename;
        }
    }
}
class LayoutFileMagic extends Magento\Framework\View\File
{
    public static int $reads = 0;
    private string $stored;
    public function __construct($filename, $module, ?Magento\Framework\View\Design\ThemeInterface $theme = null, $isBase = false)
    {
        parent::__construct($filename, $module, $theme, $isBase);
        $this->stored = $filename;
        unset($this->filename);
    }
    public function __get($name)
    {
        if ($name !== 'filename') throw new RuntimeException('Unexpected descriptor magic getter');
        self::$reads++;
        return $this->stored;
    }
}
$mode = $argv[1] ?? 'accessor';
if (!in_array($mode, ['native', 'redeclared', 'accessor', 'hook', 'magic'], true)) throw new RuntimeException('Unknown file descriptor mode');
$path = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_templateownership_native.xml';
$source = file_get_contents(BP . '/' . $path);
$declarations = LayoutManifest::declarations($path, $source);
[$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets([
    ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source), 'declarations' => $declarations],
]));
foreach ($callbacks as [$class, $method, $pre, $post]) {
    if (in_array('--without-collector', $argv, true)) continue;
    if (!\MageLens\XmlCoverage\LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException('Cannot register file descriptor proof hook');
}
$objects = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
$area->load(Magento\Framework\App\Area::PART_CONFIG);
$objects->get(Magento\Store\Model\StoreManagerInterface::class)->setCurrentStore('magelens_layout_fixture');
$area->load(Magento\Framework\App\Area::PART_DESIGN);
$counter = ['native' => LayoutFileAccessor::class, 'redeclared' => LayoutFileRedeclared::class, 'accessor' => LayoutFileAccessor::class, 'hook' => LayoutFileProperty::class, 'magic' => LayoutFileMagic::class][$mode];
if ($mode !== 'native') $objects->configure(['preferences' => [Magento\Framework\View\File::class => $counter]]);
foreach (['layout', 'block_html', 'full_page'] as $type) $objects->get(Magento\Framework\App\Cache\StateInterface::class)->setEnabled($type, false);
$objects->get(Magento\Framework\App\ViewInterface::class);
$page = $objects->get(Magento\Framework\View\Result\PageFactory::class)->create(true, ['isIsolated' => true]);
$page->addHandle(['coverageprobe_templateownership_native', 'coverageprobe_theme_index']);
$layout = $page->getLayout();
$block = $layout->getBlock('magelens.layout.template.native');
if (!str_contains($block->toHtml(), 'data-layout-mutation>xml-value</span>')) throw new RuntimeException('Native file-descriptor fixture output changed');
if (!$layout->hasElement('magelens.layout.provider.base-replacement') || $layout->hasElement('magelens.layout.provider.replaced-base')) {
    throw new RuntimeException('Native file-descriptor fixture did not apply the child theme replacement');
}
if (!in_array($mode, ['native', 'redeclared'], true) && $counter::$reads === 0) throw new RuntimeException('Native file-descriptor getter was not used');
echo "Verified native layout file collection and template output for $mode.\n";
echo 'Native file-descriptor reads: ', $counter::$reads, "\n";
if (in_array('--without-collector', $argv, true)) exit;
$expected = array_search('--expected-reads', $argv, true);
if ($expected !== false && $counter::$reads !== (int) $argv[$expected + 1]) throw new RuntimeException('Collector invoked extra native file-descriptor getters');
$lazyCalls = 0;
$lazy = (new ReflectionClass(Magento\Framework\View\File::class))->newLazyGhost(
    static function ($file) use (&$lazyCalls): void {
        $lazyCalls++;
        $file->__construct('/disposable/layout.xml', 'Fixture');
    }
);
$inspect = new ReflectionMethod(LayoutCoverage::class, 'descriptorFilename');
if ($inspect->invoke(null, $lazy) !== null || $lazyCalls !== 0) throw new RuntimeException('Descriptor inspection initialized a lazy file');
if ($lazy->getFilename() !== '/disposable/layout.xml' || $lazyCalls !== 1
    || $inspect->invoke(null, $lazy) !== '/disposable/layout.xml' || $lazyCalls !== 1) {
    throw new RuntimeException('Initialized native descriptor storage differs');
}
[, , $limits] = $collector->finish();
if (in_array('layout-file-replacement-descriptor-unconfirmed', $limits, true) !== !in_array($mode, ['native', 'redeclared'], true)) {
    throw new RuntimeException('File replacement descriptor ownership limitation differs');
}
$item = array_values(array_filter($declarations, static fn($item) => $item['layout']['kind'] === 'template'))[0];
$events = (new ReflectionProperty(Recorder::class, 'events'))->getValue();
$types = array_values(array_unique(array_column(array_filter($events, static fn($event) => $event['id'] === $item['id']), 'type')));
sort($types);
if ($types !== ['layout-template-executed', 'layout-template-selected']) throw new RuntimeException('Independent native file-read/template provenance was lost');
echo "Verified passive file-descriptor storage limits and independent original file-read/template evidence.\n";
