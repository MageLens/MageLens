<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

namespace MageLens\XmlCoverage;

final class XmlRegex
{
    public const MODULE_ADMIN_UI_PATH = '~^(?:app/code|vendor)/.+/view/(?<area>base|adminhtml)/ui_component/(?<namespace>[A-Za-z0-9_-]+)\.xml$~D';
    public const THEME_UI_PATH = '~^(?<root>app/design/.+|vendor/.+)/[^/]+_[^/]+/ui_component/(?<namespace>[A-Za-z0-9_-]+)\.xml$~D';
}
