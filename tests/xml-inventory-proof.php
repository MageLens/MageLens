<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

use MageLens\XmlCoverage\{CronFamily, Xml};
use Magento\Cron\Model\Config\{Converter\Xml as CronConverter, Reader\Xml as CronReader, SchemaLocator};
use Magento\Framework\Config\{FileResolverInterface, ValidationStateInterface};
use Magento\Framework\Module\Dir\Reader as ModuleReader;

require ($argv[1] ?? '/var/www/html/vendor') . '/autoload.php';
$hooks = dirname(getenv('MAGELENS_XML_HOOKS') ?: __DIR__ . '/../docker/php/xml-hooks.php');
require $hooks . '/xml-data.php';
require $hooks . '/xml-family-evidence.php';
require $hooks . '/xml-family-cron.php';

$literal = Xml::document('<config><!-- <!DOCTYPE html> --><![CDATA[<!DOCTYPE html>]]></config>');
if ($literal->documentElement->firstChild?->nodeValue !== ' <!DOCTYPE html> '
    || $literal->documentElement->textContent !== '<!DOCTYPE html>') {
    throw new RuntimeException('Literal XML content changed');
}
foreach ([
    '<!DOCTYPE config><config/>',
    '<!DOCTYPE config [<!ENTITY example "value">]><config>&example;</config>',
    '<!ENTITY example "value"><config/>',
] as $source) {
    try {
        Xml::document($source);
    } catch (RuntimeException $error) {
        if (!in_array($error->getMessage(), ['XML entities and DTDs are unsupported', 'Malformed XML'], true)) throw $error;
        continue;
    }
    throw new RuntimeException('An actual DTD or entity declaration was accepted');
}

$path = 'app/code/MageLens/Compatibility/etc/crontab.xml';
$template = <<<'XML'
<config%s>
    <group id="default">
        <job name="probe" instance="MageLens\Compatibility\Cli\Jobs" method="run">
            <schedule>* * * * *</schedule>
        </job>
    </group>
</config>
XML;
$resolver = new class implements FileResolverInterface {
    public array $sources = [];
    public function get($filename, $scope = null) { return $this->sources; }
};
$modules = new class extends ModuleReader {
    public function __construct() {}
    public function getModuleDir($type, $moduleName) {
        return dirname((new ReflectionClass(CronReader::class))->getFileName(), 4) . '/etc';
    }
};
$validation = new class implements ValidationStateInterface {
    public function isValidationRequired() { return true; }
};
$reader = new CronReader($resolver, new CronConverter(), new SchemaLocator($modules), $validation);
$hint = ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'
    . ' xsi:noNamespaceSchemaLocation="urn:magento:module:Magento_Cron:etc/crontab.xsd"';
$inventories = $nativeJobs = [];
foreach ([$hint, ''] as $attributes) {
    $bytes = sprintf($template, $attributes);
    $resolver->sources = [$path => $bytes];
    $nativeJobs[] = $reader->read();
    $inventories[] = CronFamily::declarations($path, $bytes);
}
if ($nativeJobs[0] !== $nativeJobs[1] || count($inventories[0]) !== 2 || $inventories[0] !== $inventories[1]) {
    throw new RuntimeException('The optional schema hint changed native cron jobs or the handler and schedule inventories');
}
echo "Verified literal XML content, DTD rejection, and native cron inventories with and without the schema hint.\n";
