<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

final class LayoutManifest
{
    public static function isLayout(string $path): bool
    {
        return (bool) preg_match('~/(?:layout|page_layout)/.+\.xml$|/(?:layouts|page_types)\.xml$~', $path)
            && !str_contains($path, '/ui_component/');
    }

    public static function declarations(string $path, string $source): array
    {
        $document = Xml::document($source);
        $root = $document->documentElement;
        $schema = $root->getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'noNamespaceSchemaLocation');
        $fileType = match (basename($path)) {
            'layouts.xml' => 'registry',
            'page_types.xml' => 'page-types',
            default => match ($schema) {
                'urn:magento:framework:View/Layout/etc/page_configuration.xsd' => 'page',
                'urn:magento:framework:View/Layout/etc/layout_generic.xsd' => 'generic',
                'urn:magento:framework:View/Layout/etc/page_layout.xsd' => 'wireframe',
                default => 'custom',
            },
        };
        $area = preg_match('~/(?:view|etc|design)/(frontend|adminhtml|base)/~', $path, $match) ? $match[1] : 'base';
        $ranges = Xml::ranges($source, $document, true);
        $handle = basename($path, '.xml');
        $result = [];
        foreach ($document->getElementsByTagName('*') as $index => $node) {
            $position = $node->getNodePath();
            $element = $node->getAttribute(match ($node->tagName) {
                'update' => 'handle',
                'move' => 'element',
                default => 'name',
            });
            $namedBlock = $element !== '' && in_array($node->tagName, ['block', 'referenceBlock'], true)
                && in_array($fileType, ['page', 'generic'], true);
            $kind = match (true) {
                $namedBlock && $node->tagName === 'block' => 'block',
                $fileType === 'page' && $node->tagName === 'move' && $element !== '' => 'move',
                $fileType === 'wireframe' && $index === 0 => 'wireframe',
                $fileType === 'page' && $node->parentNode === $root && $node->tagName === 'update' && $element !== '' => 'include',
                default => 'instruction',
            };
            $instructions = [[null, $kind]];
            foreach ($node->attributes as $attribute) {
                $kind = match (true) {
                    $fileType === 'page' && $attribute->nodeName === 'remove' && $element !== ''
                        && in_array($node->tagName, ['referenceBlock', 'referenceContainer'], true) => 'removal',
                    $namedBlock && $attribute->nodeName === 'template' && $attribute->nodeValue !== '' => 'template',
                    $fileType === 'page' && $index === 0 && $attribute->nodeName === 'layout'
                        && $attribute->nodeValue !== '' => 'wireframe-selection',
                    default => 'attribute',
                };
                $instructions[] = [$attribute->nodeName, $kind];
            }
            foreach ($instructions as [$attribute, $kind]) {
                $supported = in_array($kind, ['block', 'template', 'include', 'move', 'removal', 'wireframe', 'wireframe-selection'], true);
                $identity = $position . ($attribute === null ? '' : '/@' . $attribute);
                $result[] = [
                    'id' => hash('sha256', "$path\0layout\0$identity"),
                    'path' => $identity,
                    'family' => 'layout',
                    'declaredScope' => ['type' => $area, 'code' => ''],
                    ...$ranges[$position],
                    'node' => $identity,
                    'layout' => ['kind' => $kind, 'element' => $element, 'handle' => $handle,
                        'fileType' => $fileType, 'ordinal' => $index, 'instruction' => $node->tagName,
                        'attribute' => $attribute,
                        ...($kind === 'wireframe-selection' ? ['selection' => $node->getAttribute('layout')] : []),
                        ...($kind === 'move' ? ['destination' => $node->getAttribute('destination')] : [])],
                    'supported' => $supported,
                    'reason' => $supported ? null : self::limitation($fileType, $node->tagName, $attribute),
                ];
            }
        }
        return $result;
    }

    private static function limitation(string $fileType, string $node, ?string $attribute): string
    {
        if ($fileType === 'registry' || $fileType === 'page-types') return 'Registry consumers lack a trace back through the merged registry to this declaration';
        if ($fileType === 'wireframe') return 'The wireframe reader does not supply source attribution for this instruction';
        if ($fileType === 'custom') return 'Source grammar is outside the supported native layout schemas';
        if ($attribute === 'name' && $node === 'block') return 'Name participates in the block creation identity';
        if ($attribute === 'remove' && in_array($node, ['referenceBlock', 'referenceContainer'], true)) {
            return 'The removal queue and its cancellations are unmeasured at this reference';
        }
        if ($attribute === 'display') return 'The display decision has no source trace at the element rendering boundary';
        if ($attribute === 'cacheable') return 'Page cache eligibility is unmeasured at its native layout check';
        if ($attribute === 'ttl') return 'TTL application and subsequent cache behavior are unmeasured';
        if ($attribute === 'ifconfig' || $attribute === 'aclResource' || $attribute === 'acl') {
            return 'The native permission or configuration decision has no source trace';
        }
        if ($node === 'move') return 'This move attribute has no independent evidence for its structural effect';
        if ($node === 'remove' && $attribute === 'src') return 'Actual removal from scheduled head assets has no source trace';
        return match ($node) {
            'page', 'layout', 'update' => 'Handle selection or inclusion has no attributable runtime evidence',
            'block', 'referenceBlock', 'container', 'referenceContainer', 'move', 'remove' =>
                'Structural or visibility effects of this instruction have no source hook',
            'argument', 'arguments', 'item', 'param', 'updater', 'action' =>
                'Argument interpretation, application and action execution have no source hook',
            'uiComponent', 'visibilityCondition' => 'UI component placement and visibility have no source hook',
            'html', 'head', 'body', 'attribute', 'title', 'meta', 'link', 'css', 'script', 'font' =>
                'Page configuration and asset output have no source hook',
            default => 'This layout instruction has no runtime adapter',
        };
    }

    public static function targets(array $files): array
    {
        $result = [];
        foreach ($files as $file) {
            if ($file['family'] !== 'layout') continue;
            $targets = [];
            foreach ($file['declarations'] as $item) {
                if (!$item['supported']) continue;
                $details = $item['layout'];
                $targets[$details['ordinal']]['element'] = $details['element'];
                $targets[$details['ordinal']]['instruction'] = $details['instruction'];
                $targets[$details['ordinal']]['ids'][$details['kind']] = $item['id'];
                if (isset($details['selection'])) $targets[$details['ordinal']]['selection'] = $details['selection'];
            }
            if ($targets) $result[$file['path']] = ['hash' => $file['sourceHash'], 'targets' => $targets];
        }
        return $result;
    }
}
