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
use Magento\Framework\View\Model\Layout\Merge;

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
echo "Verified the original string identity of a numeric native layout handle.\n";
