<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

require '/var/www/html/vendor/autoload.php';
require dirname(getenv('MAGELENS_XML_HOOKS') ?: __DIR__ . '/../docker/php/xml-hooks.php') . '/xml-hooks.php';

use MageLens\XmlCoverage\LayoutCacheCoverage;
use Magento\Framework\App\Cache\State;
use Magento\Framework\App\Cache\Type\AccessProxy;
use Magento\Framework\App\DeploymentConfig;
use Magento\Framework\Cache\Frontend\Decorator\Bare;
use Magento\Framework\View\Model\Layout\Merge;

LayoutCacheCoverage::isolateLayoutCache();
$config = new class extends DeploymentConfig {
    public function __construct() {}
    public function getConfigData($key = null) { return ['layout' => 1, 'config' => 1]; }
};
$writer = (new ReflectionClass(DeploymentConfig\Writer::class))->newInstanceWithoutConstructor();
$state = new State($config, $writer);
$frontend = new class extends Bare {
    public array $entries = ['warm' => 'existing layout', 'obsolete' => 'old layout'];
    public function __construct() {}
    public function test($identifier) { return isset($this->entries[$identifier]) ? 1 : false; }
    public function load($identifier) { return $this->entries[$identifier] ?? false; }
    public function save($data, $identifier, array $tags = [], $lifeTime = null) {
        $this->entries[$identifier] = $data;
        return true;
    }
    public function remove($identifier) {
        unset($this->entries[$identifier]);
        return true;
    }
};
$layout = new AccessProxy($frontend, $state, 'layout');
$configuration = new AccessProxy($frontend, $state, 'config');
if (!$state->isEnabled('layout') || $layout->test('warm') !== false || $layout->load('warm') !== false
    || !$layout->save('new layout', 'warm') || $configuration->load('warm') !== 'existing layout'
    || !$configuration->save('new configuration', 'config') || $configuration->load('config') !== 'new configuration'
    || !$layout->remove('obsolete') || isset($frontend->entries['obsolete'])) {
    throw new RuntimeException('Native layout cache isolation leaked across cache operations');
}

$merge = (new ReflectionClass(Merge::class))->newInstanceWithoutConstructor();
$merge->addHandle('0');
$unused = static function (): void {};
$collector = new LayoutCacheCoverage(['app/code/Fixture/Module/view/frontend/layout/0.xml'],
    static fn() => ['area' => 'frontend'], $unused, $unused, $unused);
$collector->limitHandles('missing-layout-origins', $merge);
[, , , $scoped] = $collector->finish();
if ($scoped !== [['reason' => 'missing-layout-origins', 'area' => 'frontend', 'handles' => ['0']]]) {
    throw new RuntimeException('Native integer key changed the original layout handle identity');
}
echo "Verified request-local layout cache isolation and the original string identity of a numeric layout handle.\n";
