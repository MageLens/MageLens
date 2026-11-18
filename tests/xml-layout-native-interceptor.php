<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

function layoutNativeInterceptor(
    \Magento\Framework\ObjectManagerInterface $manager,
    string $native,
    ?string $plugin,
    bool $compiled = false
): string {
    $interceptor = $native . '\\Interceptor';
    $io = new \Magento\Framework\Code\Generator\Io(new \Magento\Framework\Filesystem\Driver\File(), BP . '/generated/code');
    if (class_exists($interceptor, false)) throw new RuntimeException('Ownership proof requires an unloaded disposable interceptor');
    $generated = $io->generateResultFileName($interceptor);
    $original = is_file($generated) ? file_get_contents($generated) : null;
    register_shutdown_function(static function () use ($generated, $original): void {
        if ($original === null) {
            if (is_file($generated)) unlink($generated);
        } elseif (file_put_contents($generated, $original) === false) {
            throw new RuntimeException('Cannot restore disposable generated interceptor');
        }
    });
    if ($compiled) {
        $plugins = new \Creatuity\Interception\Generator\CompiledPluginList(
            $manager, new \Creatuity\Interception\Generator\StaticScope('frontend'), cachePath: '');
        $areas = new \Creatuity\Interception\Generator\AreasPluginList(
            $manager->get(\Magento\Framework\Config\Scope::class), ['frontend' => $plugins]);
        $generator = new \Creatuity\Interception\Generator\CompiledInterceptor($areas, $native, $interceptor, $io);
    } else {
        $plugins = $manager->get(\Magento\Framework\Interception\PluginListInterface::class);
        $generator = new \Magento\Framework\Interception\Code\Generator\Interceptor($native, $interceptor, $io);
    }
    $plugins->getNext('dummy', 'dummy');
    if ($plugin !== null) {
        $plugins->merge([$native => ['plugins' => ['magelens_layout_replacement' => ['instance' => $plugin, 'sortOrder' => 1]]]]);
        $inherited = new \ReflectionProperty(\Magento\Framework\Interception\PluginList\PluginList::class, '_inherited');
        $data = $inherited->getValue($plugins);
        unset($data[$native]);
        $inherited->setValue($plugins, $data);
    }
    $file = $generator->generate();
    if (!$file) throw new RuntimeException('Native layout interceptor generation failed');
    require_once $file;
    $manager->configure(['preferences' => [$native => $interceptor]]);
    return $interceptor;
}
