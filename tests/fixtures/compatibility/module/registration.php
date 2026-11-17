<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

\Magento\Framework\Component\ComponentRegistrar::register(\Magento\Framework\Component\ComponentRegistrar::MODULE, 'MageLens_Compatibility', __DIR__);

// Kept under Test so this enabled module participates in Magento's merge
// without entering the MageLens source inventory.
\Magento\Framework\Component\ComponentRegistrar::register(\Magento\Framework\Component\ComponentRegistrar::MODULE,
    'MageLens_ObserverOverride', __DIR__ . '/Test/ObserverOverride');
require __DIR__ . '/Test/ObserverOverride/ExternalObserver.php';
require __DIR__ . '/Test/ObserverOverride/ExternalPlugin.php';
