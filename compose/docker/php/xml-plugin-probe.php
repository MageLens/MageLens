<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\Interception\{Interceptor, InterceptorInterface};
use Magento\Framework\Interception\PluginList\PluginList;

class PluginHookProbeSubject
{
    public function run(): void {}
}

final class PluginHookProbe extends PluginHookProbeSubject implements InterceptorInterface
{
    use Interceptor;

    public function __construct(PluginList $list)
    {
        $this->pluginList = $list;
        $this->subjectType = self::class;
    }

    public function run(): void
    {
        $this->___callPlugins('run', [], $this->pluginList->getNext($this->subjectType, 'run'));
    }
}

final class PluginHookProbeBody
{
    public function beforeRun(PluginHookProbeSubject $subject): void {}
}
