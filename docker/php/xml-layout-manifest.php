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
                'action' => 'method',
                'remove' => $node->parentNode->nodeName === 'head' ? 'src' : 'name',
                default => 'name',
            });
            $namedBlock = $element !== '' && in_array($node->tagName, ['block', 'referenceBlock'], true)
                && in_array($fileType, ['page', 'generic'], true);
            $kind = match (true) {
                in_array($fileType, ['page', 'generic'], true) && $index === 0
                    && preg_match('~/layout/override/(?:base|theme)/~', $path) => 'file-override',
                $namedBlock && $node->tagName === 'block' => 'block',
                in_array($fileType, ['page', 'generic', 'wireframe'], true)
                    && $node->tagName === 'container' && $element !== '' => 'container',
                in_array($fileType, ['page', 'generic'], true) && $node->tagName === 'uiComponent'
                    && $element !== '' => 'ui-placement',
                $fileType === 'page' && $node->tagName === 'attribute'
                    && $node->parentNode->nodeName === 'body' && $element === 'class' => 'body-class',
                $fileType === 'page' && $node->tagName === 'attribute'
                    && in_array($node->parentNode->nodeName, ['html', 'head', 'body'], true)
                    && $element !== '' && !($node->parentNode->nodeName === 'body' && $element === 'class') => 'page-attribute',
                $fileType === 'page' && $node->tagName === 'meta' && $node->parentNode->nodeName === 'head'
                    && $element !== '' => 'metadata',
                $fileType === 'page' && $node->parentNode->nodeName === 'head'
                    && in_array($node->tagName, ['css', 'script', 'link', 'font'], true)
                    && $node->getAttribute('src') !== '' => 'asset-reference',
                $fileType === 'page' && $node->tagName === 'action' && $element !== ''
                    && in_array($node->parentNode->nodeName, ['block', 'referenceBlock'], true) => 'action',
                $fileType === 'page' && $node->tagName === 'argument' && $element !== ''
                    && $node->parentNode->nodeName === 'action' => 'action-argument',
                $fileType === 'page' && $node->tagName === 'title' && $node->parentNode->nodeName === 'head' => 'page-title',
                $fileType === 'page' && self::blockArgument($node) => 'argument',
                $fileType === 'page' && $node->tagName === 'move' && $element !== '' => 'move',
                $fileType === 'wireframe' && $index === 0 => 'wireframe',
                in_array($fileType, ['page', 'generic', 'wireframe'], true)
                    && $node->parentNode === $root && $node->tagName === 'update' && $element !== '' => 'include',
                default => 'instruction',
            };
            $valueKind = $kind;
            $instructions = [[null, $kind]];
            foreach ($node->attributes as $attribute) {
                $kind = match (true) {
                    $valueKind === 'asset-reference' && $attribute->nodeName === 'src' => 'asset-src',
                    $valueKind === 'asset-reference' && $attribute->nodeName === 'src_type' => 'asset-src-type',
                    $valueKind === 'asset-reference' && $attribute->nodeName === 'order' => 'asset-order',
                    $valueKind === 'asset-reference' && $attribute->nodeName === 'ie_condition' => 'asset-condition',
                    $valueKind === 'asset-reference' && in_array($attribute->nodeName, ['defer', 'async', 'charset',
                        'hreflang', 'media', 'rel', 'rev', 'sizes', 'target', 'type', 'integrity', 'crossorigin', 'as'], true) =>
                            'asset-attribute-' . $attribute->nodeName,
                    in_array($valueKind, ['page-attribute', 'metadata', 'body-class'], true)
                        && in_array($attribute->nodeName, $valueKind === 'metadata' ? ['name', 'content'] : ['name', 'value'], true) =>
                            $valueKind . '-' . $attribute->nodeName,
                    in_array($fileType, ['page', 'generic', 'wireframe'], true) && $element !== ''
                        && in_array($node->tagName, ['container', 'referenceContainer'], true)
                        && in_array($attribute->nodeName, ['htmlTag', 'htmlId', 'htmlClass', 'display'], true) =>
                            'container-' . $attribute->nodeName,
                    $namedBlock && $attribute->nodeName === 'display' => 'block-display',
                    in_array($fileType, ['page', 'generic'], true) && $element !== ''
                        && in_array($node->tagName, ['block', 'uiComponent'], true)
                        && in_array($attribute->nodeName, ['ifconfig', 'aclResource', 'acl'], true) =>
                            'condition-' . $attribute->nodeName,
                    $namedBlock && in_array($attribute->nodeName, ['class', 'group', 'ttl'], true) =>
                        'block-' . $attribute->nodeName,
                    $namedBlock && $node->tagName === 'block' && $attribute->nodeName === 'cacheable'
                        && $attribute->nodeValue === 'false' => 'cacheability',
                    $fileType === 'page' && $attribute->nodeName === 'remove' && $element !== ''
                        && in_array($node->tagName, ['referenceBlock', 'referenceContainer'], true) => 'removal',
                    $fileType === 'page' && $node->tagName === 'remove' && $node->parentNode->nodeName === 'head'
                        && $attribute->nodeName === 'src' && $element !== '' => 'asset-removal',
                    $namedBlock && $attribute->nodeName === 'template' && $attribute->nodeValue !== '' => 'template',
                    $fileType === 'page' && $index === 0 && $attribute->nodeName === 'layout'
                        && $attribute->nodeValue !== '' => 'wireframe-selection',
                    default => 'attribute',
                };
                $instructions[] = [$attribute->nodeName, $kind];
            }
            foreach ($instructions as [$attribute, $kind]) {
                $supported = in_array($kind, ['block', 'template', 'action', 'action-argument', 'argument', 'include', 'move', 'removal',
                    'wireframe', 'wireframe-selection', 'page-title', 'asset-removal', 'container',
                    'container-htmlTag', 'container-htmlId', 'container-htmlClass', 'container-display', 'block-display', 'ui-placement',
                    'page-attribute', 'page-attribute-name', 'page-attribute-value', 'metadata', 'metadata-name', 'metadata-content',
                    'block-class', 'block-group', 'block-ttl', 'cacheability',
                    'condition-ifconfig', 'condition-aclResource', 'condition-acl', 'file-override'], true);
                $supported = $supported || str_starts_with($kind, 'asset-attribute-')
                    || in_array($kind, ['asset-reference', 'asset-src', 'asset-src-type', 'asset-order', 'asset-condition',
                        'body-class', 'body-class-name', 'body-class-value'], true);
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

    private static function blockArgument(\DOMElement $node): bool
    {
        $type = static fn($element) => $element->getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'type');
        if (!in_array($node->tagName, ['argument', 'item'], true) || !$node->hasAttribute('name')
            || !in_array($type($node), ['string', 'number', 'boolean', 'null', 'const', 'serviceUrl',
                'array', 'object', 'options', 'url', 'helper', 'configurableObject'], true)) return false;
        while ($node->tagName === 'item') {
            $node = $node->parentNode;
            if (!$node instanceof \DOMElement || !in_array($node->tagName, ['argument', 'item'], true)
                || $type($node) !== 'array' || $node->getElementsByTagName('updater')->length) return false;
        }
        return $node->parentNode->nodeName === 'arguments'
            && in_array($node->parentNode->parentNode->nodeName, ['block', 'referenceBlock'], true);
    }

    private static function limitation(string $fileType, string $node, ?string $attribute): string
    {
        if ($fileType === 'registry' || $fileType === 'page-types') return 'Registry consumers lack a trace back through the merged registry to this declaration';
        if ($fileType === 'wireframe') return 'The wireframe reader does not supply source attribution for this instruction';
        if ($fileType === 'custom') return 'Source grammar is outside the supported native layout schemas';
        if ($node === 'uiComponent' && $attribute === 'component') {
            return 'The native layout generator creates the component by name and does not pass this component attribute to its factory';
        }
        if ($attribute === 'name' && $node === 'block') return 'Name participates in the block creation identity';
        if ($attribute === 'method' && $node === 'action') return 'Method participates in the identity of the parent action call';
        if ($attribute === 'remove' && in_array($node, ['referenceBlock', 'referenceContainer'], true)) {
            return 'The removal queue and its cancellations are unmeasured at this reference';
        }
        if ($attribute === 'display') return 'The display decision has no source trace at the element rendering boundary';
        if ($attribute === 'cacheable') return 'The native page-cache selector visits block declarations whose cacheable attribute is the literal false';
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
            'argument', 'arguments', 'item', 'param', 'updater' =>
                'This argument type, nested value, or modifier has no trace to its native interpretation and application',
            'action' => 'This action declaration or modifier has no trace to a native call or scope decision',
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
