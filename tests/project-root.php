<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

return is_file(__DIR__ . '/../compose/install.sh') ? __DIR__ . '/../compose' : dirname(__DIR__);
