<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

$editorUser = 'editor_' . substr($prefix, strlen('coverage-'), 32);
if (($old['navigation']['user'] ?? null) !== $editorUser) {
    throw new RuntimeException('Invalid fixture editor cleanup identity.');
}
$editor = $om->create(\Magento\User\Model\User::class)->loadByUsername($editorUser);
if ($editor->getId()) $editor->delete();
$editorRole = $om->create(\Magento\Authorization\Model\Role::class)->load($prefix . 'editor', 'role_name');
if ($editorRole->getId()) $editorRole->delete();
