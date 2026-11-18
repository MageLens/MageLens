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
    $configuration = $manager->get(\Magento\Framework\ObjectManager\ConfigInterface::class);
    if ($configuration instanceof \Magento\Framework\ObjectManager\Config\Compiled) {
        $arguments = (new ReflectionProperty(\Magento\Framework\ObjectManager\Config\Compiled::class, 'arguments'))
            ->getRawValue($configuration);
        $replace = static function (array $data) use (&$replace, $native, $interceptor): array {
            foreach ($data as $key => $value) {
                if (in_array($key, ['_i_', '_ins_'], true) && $value === $native) $data[$key] = $interceptor;
                elseif (is_array($value)) $data[$key] = $replace($value);
            }
            return $data;
        };
        $arguments = $replace($arguments);
        $parameters = (new ReflectionMethod($interceptor, '__construct'))->getParameters();
        $names = array_fill_keys(array_map(static fn($parameter) => $parameter->getName(), $parameters), true);
        if (isset($arguments[$interceptor]) && is_array($arguments[$interceptor])) {
            // Retain only dependencies accepted by the newly generated constructor.
            $arguments[$interceptor] = array_intersect_key($arguments[$interceptor], $names);
        }
        // Match the compiler's constructor dependency references. Mapping a
        // native class to its interceptor as a virtual type creates a cycle
        // in native plugin inheritance, so instanceTypes stays unchanged.
        $configuration->extend(['arguments' => $arguments]);
    }
    $preferences = [$native => $interceptor];
    if ($native === \Magento\Framework\View\Model\Layout\Merge::class) {
        // Compiled configuration flattens interface preference chains. Bind
        // the processor factory's interface to the requested native fixture.
        $preferences[\Magento\Framework\View\Layout\ProcessorInterface::class] = $interceptor;
    }
    $manager->configure(['preferences' => $preferences]);
    return $interceptor;
}
