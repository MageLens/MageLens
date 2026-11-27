<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

final class LayoutDeclarationKinds
{
    private const SUPPORTED = [
        'block', 'reference', 'reference-name', 'template', 'action', 'action-method', 'action-ifconfig',
        'action-argument', 'action-argument-name', 'action-item', 'action-item-name', 'configured-argument',
        'configured-argument-name', 'configured-item', 'configured-item-name', 'argument', 'argument-name',
        'argument-type', 'argument-translate', 'argument-shared', 'argument-model', 'argument-helper',
        'argument-path', 'argument-updater', 'argument-group', 'parameter', 'parameter-name', 'include',
        'include-handle', 'file-selection', 'registry-entry', 'registry-id', 'registry-label', 'page-type',
        'page-type-id', 'page-type-label', 'move', 'removal', 'wireframe', 'wireframe-selection', 'page-title',
        'asset-removal', 'asset-removal-node', 'container', 'container-htmlTag', 'container-htmlId',
        'container-htmlClass', 'container-label', 'container-display', 'block-display', 'ui-placement',
        'page-attribute', 'page-attribute-name', 'page-attribute-value', 'metadata', 'metadata-name',
        'metadata-content', 'block-class', 'block-group', 'block-ttl', 'cacheability', 'position-name',
        'position-as', 'position-before', 'position-after', 'move-element', 'move-destination', 'move-as',
        'move-before', 'move-after', 'handle-label', 'handle-type', 'condition-ifconfig',
        'condition-aclResource', 'condition-acl', 'file-override', 'visibility', 'visibility-name',
        'visibility-class', 'visibility-argument', 'visibility-argument-name', 'ui-group', 'asset-reference',
        'asset-src', 'asset-src-type', 'asset-order', 'asset-condition', 'body-class', 'body-class-name',
        'body-class-value',
    ];

    public const IGNORED_ARGUMENT_DESCENDANTS = [
        'argument', 'argument-name', 'argument-type', 'argument-updater', 'argument-translate',
        'argument-shared', 'argument-model', 'argument-helper', 'argument-path', 'parameter', 'parameter-name',
        'configured-argument', 'configured-argument-name', 'configured-item', 'configured-item-name',
        'visibility-argument', 'visibility-argument-name',
    ];

    public static function supports(string $kind): bool
    {
        static $supported;
        $supported ??= array_fill_keys(self::SUPPORTED, true);
        return isset($supported[$kind]) || str_starts_with($kind, 'asset-attribute-');
    }
}
