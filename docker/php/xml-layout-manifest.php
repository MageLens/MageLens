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
        return self::provider($path) !== null;
    }

    public static function provider(string $path, array $vendorThemes = []): ?array
    {
        $area = '(?<area>frontend|adminhtml|base)';
        $module = '(?:app/code/[^/]+(?:/[^/]+)?|vendor/[^/]+/[^/]+(?:/(?!view/|etc/|web/)[^/]+)*)';
        $theme = "(?:app/design/$area/[^/]+/[^/]+|vendor/[^/]+/[^/]+)";
        $paths = [
            ['module', 'handle', "~^$module/view/$area/layout/[^/]+\\.xml$~D"],
            ['module', 'wireframe', "~^$module/view/$area/page_layout/[^/]+\\.xml$~D"],
            ['module', 'registry', "~^$module/view/$area/layouts\\.xml$~D"],
            ['module', 'page-types', "~^$module/etc/(?:$area/)?page_types\\.xml$~D"],
            ['theme', 'handle', "~^$theme/[^/]+_[^/]+/layout/[^/]+\\.xml$~D"],
            ['theme', 'override', "~^$theme/[^/]+_[^/]+/layout/override/(?:base|theme/[^/]+/[^/]+)/[^/]+\\.xml$~D"],
            ['theme', 'wireframe', "~^$theme/[^/]+_[^/]+/page_layout/(?:override/(?:base|theme/[^/]+/[^/]+)/)?[^/]+\\.xml$~D"],
            ['theme', 'registry', "~^$theme/[^/]+_[^/]+/layouts\\.xml$~D"],
        ];
        foreach ($paths as [$type, $document, $pattern]) {
            if (!preg_match($pattern, $path, $match)) continue;
            $scope = ($match['area'] ?? '') ?: 'base';
            if ($type === 'theme' && str_starts_with($path, 'vendor/')) {
                $root = implode('/', array_slice(explode('/', $path), 0, 3));
                $scope = $vendorThemes[$root] ?? $scope;
            }
            return ['type' => $type, 'document' => $document, 'area' => $scope];
        }
        return null;
    }

    public static function declarations(string $path, string $source, ?array $provider = null): array
    {
        $provider ??= self::provider($path);
        if ($provider === null) return [];
        $document = Xml::document($source);
        $root = $document->documentElement;
        $fileType = match ([$provider['document'], $root->tagName, $root->namespaceURI]) {
            ['registry', 'page_layouts', null] => 'registry',
            ['page-types', 'page_types', null] => 'page-types',
            ['wireframe', 'layout', null] => 'wireframe',
            ['handle', 'page', null], ['override', 'page', null] => 'page',
            ['handle', 'layout', null], ['override', 'layout', null] => 'generic',
            default => 'custom',
        };
        $area = $provider['area'];
        $ranges = Xml::ranges($source, $document, true, true);
        $handle = basename($path, '.xml');
        $result = [];
        foreach ($document->getElementsByTagName('*') as $index => $node) {
            $position = $node->getNodePath();
            $element = $node->getAttribute(match ($node->tagName) {
                'layout' => $fileType === 'registry' ? 'id' : 'name',
                'type' => $fileType === 'page-types' ? 'id' : 'name',
                'update' => 'handle',
                'move' => 'element',
                'action' => 'method',
                'remove' => $node->parentNode->nodeName === 'head' ? 'src' : 'name',
                default => 'name',
            });
            $blockNode = ($node->tagName === 'block' || ($node->tagName === 'referenceBlock' && $element !== ''))
                && in_array($fileType, ['page', 'generic', 'wireframe'], true);
            $kind = match (true) {
                in_array($fileType, ['page', 'generic', 'wireframe'], true) && $node->tagName === 'visibilityCondition' => 'visibility',
                in_array($fileType, ['page', 'generic', 'wireframe'], true) && self::visibilityArgument($node) => 'visibility-argument',
                $fileType === 'page-types' && $node->parentNode === $root && $node->tagName === 'type' => 'page-type',
                $fileType === 'registry' && $node->parentNode === $root && $node->tagName === 'layout' => 'registry-entry',
                $fileType === 'registry' && $node->parentNode->parentNode === $root
                    && $node->parentNode->nodeName === 'layout' && $node->tagName === 'label' => 'registry-label',
                in_array($fileType, ['page', 'generic'], true) && $index === 0
                    && $provider['document'] === 'override' => 'file-override',
                in_array($fileType, ['page', 'generic'], true) && $index === 0 => 'file-selection',
                $blockNode && $node->tagName === 'block' => 'block',
                in_array($fileType, ['page', 'generic', 'wireframe'], true)
                    && in_array($node->tagName, ['referenceBlock', 'referenceContainer'], true) && $element !== '' => 'reference',
                in_array($fileType, ['page', 'generic', 'wireframe'], true)
                    && $node->tagName === 'container' => 'container',
                in_array($fileType, ['page', 'generic', 'wireframe'], true) && $node->tagName === 'uiComponent'
                    && $element !== '' => 'ui-placement',
                $fileType === 'page' && $node->tagName === 'attribute'
                    && $node->parentNode->nodeName === 'body' && $element === 'class' => 'body-class',
                $fileType === 'page' && $node->tagName === 'attribute'
                    && in_array($node->parentNode->nodeName, ['html', 'head', 'body'], true)
                    && !($node->parentNode->nodeName === 'body' && $element === 'class') => 'page-attribute',
                $fileType === 'page' && $node->tagName === 'meta' && $node->parentNode->nodeName === 'head' => 'metadata',
                $fileType === 'page' && $node->parentNode->nodeName === 'head'
                    && in_array($node->tagName, ['css', 'script', 'link', 'font'], true)
                    && $node->hasAttribute('src') => 'asset-reference',
                $fileType === 'page' && $node->parentNode->nodeName === 'head'
                    && $node->tagName === 'remove' && $node->hasAttribute('src') => 'asset-removal-node',
                in_array($fileType, ['page', 'generic', 'wireframe'], true) && $node->tagName === 'action' && $node->hasAttribute('method')
                    && in_array($node->parentNode->nodeName, ['block', 'referenceBlock'], true) => 'action',
                in_array($fileType, ['page', 'generic', 'wireframe'], true) && $node->tagName === 'argument' && $element !== ''
                    && $node->parentNode->nodeName === 'action' => 'action-argument',
                in_array($fileType, ['page', 'generic', 'wireframe'], true) && $node->tagName === 'item'
                    && self::actionArrayItem($node) => 'action-item',
                in_array($fileType, ['page', 'generic', 'wireframe'], true)
                    && self::configuredOperand($node) => $node->tagName === 'argument' ? 'configured-argument' : 'configured-item',
                $fileType === 'page' && $node->tagName === 'title' && $node->parentNode->nodeName === 'head' => 'page-title',
                in_array($fileType, ['page', 'generic', 'wireframe'], true) && $node->tagName === 'arguments'
                    && in_array($node->parentNode->nodeName, ['block', 'referenceBlock', 'visibilityCondition'], true) => 'argument-group',
                in_array($fileType, ['page', 'generic', 'wireframe'], true) && self::blockArgument($node) => 'argument',
                in_array($fileType, ['page', 'generic', 'wireframe'], true) && $node->tagName === 'param'
                    && (self::blockArgument($node->parentNode) || self::actionArrayItem($node->parentNode)
                        || $node->parentNode->parentNode->nodeName === 'action'
                        || ($node->parentNode->tagName === 'item' && $node->parentNode->getAttribute('xsi:type') === 'url'
                            && self::configuredOperand($node->parentNode)))
                    && in_array($node->parentNode->getAttribute('xsi:type'), ['helper', 'url'], true) => 'parameter',
                in_array($fileType, ['page', 'generic', 'wireframe'], true) && $node->tagName === 'updater'
                    && self::blockArgument($node->parentNode) => 'argument-updater',
                in_array($fileType, ['page', 'generic', 'wireframe'], true) && $node->tagName === 'move' && $element !== '' => 'move',
                $fileType === 'wireframe' && $index === 0 => 'wireframe',
                in_array($fileType, ['page', 'generic', 'wireframe'], true)
                    && $node->parentNode === $root && $node->tagName === 'update' && $element !== '' => 'include',
                default => 'instruction',
            };
            $valueKind = $kind;
            $instructions = [[null, $kind]];
            foreach ($node->attributes as $attribute) {
                $kind = match (true) {
                    in_array($fileType, ['page', 'generic', 'wireframe'], true)
                        && $attribute->namespaceURI === 'http://www.w3.org/2001/XMLSchema-instance'
                        && $attribute->localName === 'noNamespaceSchemaLocation' => 'schema-hint',
                    $valueKind === 'action' && $attribute->nodeName === 'method' => 'action-method',
                    $valueKind === 'action' && $attribute->nodeName === 'ifconfig' => 'action-ifconfig',
                    in_array($valueKind, ['argument', 'action-argument', 'action-item', 'configured-argument', 'configured-item', 'visibility-argument'], true) && $attribute->nodeName === 'xsi:type' => 'argument-type',
                    in_array($valueKind, ['argument', 'action-argument', 'action-item', 'configured-argument', 'configured-item', 'visibility-argument'], true) && in_array($attribute->nodeName, ['translate', 'shared', 'model', 'helper', 'path'], true) => 'argument-' . $attribute->nodeName,
                    $valueKind === 'argument' && $attribute->nodeName === 'name' => 'argument-name',
                    $valueKind === 'visibility-argument' && $attribute->nodeName === 'name' => 'visibility-argument-name',
                    $valueKind === 'action-item' && $attribute->nodeName === 'name' => 'action-item-name',
                    in_array($valueKind, ['configured-argument', 'configured-item'], true)
                        && $attribute->nodeName === 'name' => $valueKind . '-name',
                    $valueKind === 'parameter' && $attribute->nodeName === 'name' => 'parameter-name',
                    $valueKind === 'action-argument' && $attribute->nodeName === 'name' => 'action-argument-name',
                    $valueKind === 'reference' && $attribute->nodeName === 'name' => 'reference-name',
                    $valueKind === 'move' && in_array($attribute->nodeName, ['element', 'destination', 'as', 'before', 'after'], true) => 'move-' . $attribute->nodeName,
                    $fileType === 'page' && $index === 0 && $attribute->nodeName === 'label' => 'handle-label',
                    $fileType === 'page' && $index === 0 && $attribute->nodeName === 'design_abstraction' => 'handle-type',
                    $valueKind === 'visibility' && $attribute->nodeName === 'name' => 'visibility-name',
                    $valueKind === 'visibility' && $attribute->nodeName === 'className' => 'visibility-class',
                    $valueKind === 'ui-placement' && $attribute->nodeName === 'group' => 'ui-group',
                    $valueKind === 'page-type' && in_array($attribute->nodeName, ['id', 'label'], true) => 'page-type-' . $attribute->nodeName,
                    $valueKind === 'registry-entry' && $attribute->nodeName === 'id' => 'registry-id',
                    $valueKind === 'include' && $attribute->nodeName === 'handle' => 'include-handle',
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
                    in_array($fileType, ['page', 'generic', 'wireframe'], true)
                        && ($node->tagName === 'container' || ($node->tagName === 'referenceContainer' && $element !== ''))
                        && in_array($attribute->nodeName, ['htmlTag', 'htmlId', 'htmlClass', 'display', 'label'], true) =>
                            'container-' . $attribute->nodeName,
                    in_array($fileType, ['page', 'generic', 'wireframe'], true)
                        && in_array($node->tagName, ['block', 'container', 'uiComponent'], true)
                        && in_array($attribute->nodeName, ['name', 'as', 'before', 'after'], true) => 'position-' . $attribute->nodeName,
                    $blockNode && $attribute->nodeName === 'display' => 'block-display',
                    in_array($fileType, ['page', 'generic', 'wireframe'], true) && $element !== ''
                        && in_array($node->tagName, ['block', 'uiComponent'], true)
                        && in_array($attribute->nodeName, ['ifconfig', 'aclResource', 'acl'], true) =>
                            'condition-' . $attribute->nodeName,
                    $blockNode && in_array($attribute->nodeName, ['class', 'group', 'ttl'], true) =>
                        'block-' . $attribute->nodeName,
                    in_array($fileType, ['page', 'generic'], true) && $blockNode
                        && $node->tagName === 'block' && $attribute->nodeName === 'cacheable'
                        && $attribute->nodeValue === 'false' => 'cacheability',
                    in_array($fileType, ['page', 'generic', 'wireframe'], true) && $attribute->nodeName === 'remove' && $element !== ''
                        && in_array($node->tagName, ['referenceBlock', 'referenceContainer'], true) => 'removal',
                    $fileType === 'page' && $node->tagName === 'remove' && $node->parentNode->nodeName === 'head'
                        && $attribute->nodeName === 'src' => 'asset-removal',
                    $blockNode && $attribute->nodeName === 'template' => 'template',
                    $fileType === 'page' && $index === 0 && $attribute->nodeName === 'layout'
                        && $attribute->nodeValue !== '' => 'wireframe-selection',
                    default => 'attribute',
                };
                $instructions[] = [$attribute->nodeName, $kind];
            }
            $elementRange = $ranges[$position];
            $attributeRanges = $elementRange['attributes'];
            unset($elementRange['attributes']);
            foreach ($instructions as [$attribute, $kind]) {
                $supported = in_array($kind, ['block', 'reference', 'reference-name', 'template', 'action', 'action-method', 'action-ifconfig', 'action-argument', 'action-argument-name', 'action-item', 'action-item-name', 'configured-argument', 'configured-argument-name', 'configured-item', 'configured-item-name', 'argument', 'argument-name', 'argument-type', 'argument-translate', 'argument-shared', 'argument-model', 'argument-helper', 'argument-path', 'argument-updater', 'argument-group', 'parameter', 'parameter-name', 'include', 'include-handle', 'file-selection', 'registry-entry', 'registry-id', 'registry-label', 'page-type', 'page-type-id', 'page-type-label', 'move', 'removal',
                    'wireframe', 'wireframe-selection', 'page-title', 'asset-removal', 'asset-removal-node', 'container',
                    'container-htmlTag', 'container-htmlId', 'container-htmlClass', 'container-label', 'container-display', 'block-display', 'ui-placement',
                    'page-attribute', 'page-attribute-name', 'page-attribute-value', 'metadata', 'metadata-name', 'metadata-content',
                    'block-class', 'block-group', 'block-ttl', 'cacheability',
                    'position-name', 'position-as', 'position-before', 'position-after',
                    'move-element', 'move-destination', 'move-as', 'move-before', 'move-after',
                    'handle-label', 'handle-type',
                    'condition-ifconfig', 'condition-aclResource', 'condition-acl', 'file-override',
                    'visibility', 'visibility-name', 'visibility-class', 'visibility-argument', 'visibility-argument-name', 'ui-group'], true);
                $supported = $supported || str_starts_with($kind, 'asset-attribute-')
                    || in_array($kind, ['asset-reference', 'asset-src', 'asset-src-type', 'asset-order', 'asset-condition',
                        'body-class', 'body-class-name', 'body-class-value'], true);
                $emptyGroup = $kind === 'argument-group';
                if ($emptyGroup) foreach ($node->childNodes as $child) {
                    if ($child instanceof \DOMElement && $child->tagName === 'argument') $emptyGroup = false;
                }
                if ($emptyGroup) $supported = false;
                $ignoredWrapper = $fileType === 'wireframe' && self::wireframeWrapper($node);
                if ($ignoredWrapper || $kind === 'file-selection') $supported = false;
                $typeAttribute = $attribute === null ? null : $node->getAttributeNode($attribute);
                $discardedType = in_array($fileType, ['page', 'generic', 'wireframe'], true)
                    && in_array($node->tagName, ['argument', 'item'], true)
                    && $typeAttribute && $typeAttribute->namespaceURI === 'http://www.w3.org/2001/XMLSchema-instance'
                    && $typeAttribute->localName === 'type' && $typeAttribute->nodeName !== 'xsi:type';
                $identity = $position . ($attribute === null ? '' : '/@' . $attribute);
                $result[] = [
                    'id' => hash('sha256', "$path\0layout\0$identity"),
                    'path' => $identity,
                    'family' => 'layout',
                    'declaredScope' => ['type' => $area, 'code' => ''],
                    ...($attribute === null ? $elementRange : $attributeRanges[$attribute]),
                    'node' => $identity,
                    'layout' => ['kind' => $kind, 'element' => $element, 'handle' => $handle,
                        'fileType' => $fileType, 'ordinal' => $index, 'instruction' => $node->tagName,
                        'attribute' => $attribute,
                        ...($kind === 'wireframe-selection' ? ['selection' => $node->getAttribute('layout')] : []),
                        ...($kind === 'move' ? ['destination' => $node->getAttribute('destination')] : [])],
                    'supported' => $supported,
                    'reason' => $emptyGroup ? 'The native layout schema requires at least one argument in this group. Empty groups are outside the valid layout grammar' : ($kind === 'schema-hint'
                        ? 'Native file packaging omits this namespaced schema hint. Layout validation uses the engine\'s configured schema'
                        : ($kind === 'file-selection'
                        ? 'This root records native file selection at the merged-XML stage. Coverage requires an attributable instruction effect'
                        : ($supported ? null : ($ignoredWrapper
                        ? 'The installed wireframe root reader pool ignores head and body branches, including their descendants'
                        : ($discardedType
                        ? 'The reviewed native layout serializer preserves type attributes only under the literal xsi prefix. This namespace-equivalent attribute is discarded before argument interpretation'
                        : self::limitation($fileType, $node->tagName, $attribute, $node)))))),
                ];
            }
        }
        return $result;
    }

    private static function wireframeWrapper(\DOMElement $node): bool
    {
        while ($node->parentNode instanceof \DOMElement && $node->parentNode->tagName !== 'layout') {
            $node = $node->parentNode;
        }
        return in_array($node->tagName, ['head', 'body'], true);
    }

    private static function visibilityArgument(\DOMElement $node): bool
    {
        if (!in_array($node->tagName, ['argument', 'item'], true) || $node->getAttribute('name') === '') return false;
        while ($node->tagName === 'item' && $node->parentNode instanceof \DOMElement) $node = $node->parentNode;
        return $node->tagName === 'argument' && $node->parentNode->nodeName === 'arguments'
            && $node->parentNode->parentNode->nodeName === 'visibilityCondition';
    }

    private static function configuredOperand(\DOMElement $node): bool
    {
        if (!in_array($node->tagName, ['argument', 'item'], true) || !$node->hasAttribute('name')) return false;
        if (self::unkeyedConfiguredOperand($node)) return false;
        $configured = false;
        while (in_array($node->tagName, ['argument', 'item'], true)) {
            $parent = $node->parentNode;
            if (!$parent instanceof \DOMElement) return false;
            if ($node->tagName === 'argument' && in_array($parent->tagName, ['arguments', 'action'], true)) {
                return $configured && ($parent->tagName === 'action' || self::blockArgument($node));
            }
            if ($node->tagName === 'argument') {
                if ($parent->getAttribute('xsi:type') !== 'configurableObject') return false;
                $configured = true;
            } elseif ($parent->getAttribute('xsi:type') !== 'array') {
                return false;
            }
            $node = $parent;
        }
        return false;
    }

    private static function unkeyedConfiguredOperand(\DOMElement $node): bool
    {
        while ($node->parentNode instanceof \DOMElement && in_array($node->tagName, ['argument', 'item'], true)) {
            if ($node->tagName === 'argument' && $node->parentNode->tagName === 'item'
                && $node->parentNode->getAttribute('xsi:type') === 'configurableObject') return true;
            $node = $node->parentNode;
        }
        return false;
    }

    private static function actionArrayItem(\DOMElement $node): bool
    {
        if ($node->tagName !== 'item' || !$node->hasAttribute('name')) return false;
        do {
            $node = $node->parentNode;
            if (!$node instanceof \DOMElement || $node->getAttribute('xsi:type') !== 'array'
                || $node->getElementsByTagName('updater')->length) return false;
        } while ($node->tagName === 'item');
        return $node->tagName === 'argument' && $node->parentNode->nodeName === 'action';
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

    private static function limitation(string $fileType, string $node, ?string $attribute, ?\DOMElement $element = null): string
    {
        if ($element && self::unkeyedConfiguredOperand($element)) {
            return 'The native layout parser does not key configurable object arguments under an array item. This subtree cannot supply named constructor operands';
        }
        if ($node === 'param' && $element?->parentNode instanceof \DOMElement
            && $element->parentNode->getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'type') === 'serviceUrl') {
            return 'The installed ServiceUrl interpreter reads path and ignores all param children. This parameter has no native application effect';
        }
        if ($node === 'param' && $element?->parentNode instanceof \DOMElement && self::configuredOperand($element->parentNode)) {
            $parent = $element->parentNode;
            if ($parent->getAttribute('xsi:type') === 'helper') {
                return 'The native configurable object interpreter uses the base Composite, which has no helper interpreter. No named parameter is evaluated';
            }
            if ($parent->tagName === 'argument' && $parent->getAttribute('xsi:type') === 'url') {
                return 'The native layout parser flattens a single parameter under a direct configurable URL argument and rejects repeated parameters. The URL interpreter requires a keyed parameter map';
            }
        }
        if ($node === 'updater' && in_array($attribute, ['enabled', 'sortOrder'], true)) {
            return 'Native parsing turns an attributed updater into an array class descriptor. The decorator passes it to ObjectManager::get and raises TypeError before flag or ordering effects can occur';
        }
        if ($element && in_array($fileType, ['page', 'generic', 'wireframe'], true)) {
            $ancestor = $element;
            while ($ancestor->parentNode instanceof \DOMElement) {
                if ($ancestor->tagName === 'argument' && $ancestor->parentNode->tagName === 'uiComponent') {
                    return 'The native UI layout reader does not forward direct component arguments to the component factory';
                }
                $ancestor = $ancestor->parentNode;
            }
        }
        if ($fileType === 'registry' && $node === 'label' && $attribute === 'translate') {
            return 'The schema fixes this flag to true. Native registry extraction consumes label text and leaves the flag unused';
        }
        if (in_array($node, ['page_layouts', 'page_types'], true)
            && in_array($fileType, ['registry', 'page-types'], true)) {
            return 'The native registry reader uses this envelope to validate and merge entries. Its consumers read the individual entry fields';
        }
        if ($fileType === 'page' && $attribute === null && in_array($node, ['html', 'head', 'body'], true)) {
            return 'The native page reader dispatches the children of this wrapper. Runtime effects belong to the individual instructions';
        }
        if ($fileType === 'registry' || $fileType === 'page-types') return 'Registry consumers lack a trace back through the merged registry to this declaration';
        if ($fileType === 'wireframe' && $node === 'block' && $attribute === 'cacheable') {
            return 'The native page-cache selector scans the main merged layout XML and does not visit wireframe block declarations';
        }
        if ($fileType === 'page' && $node === 'meta' && in_array($attribute, ['http-equiv', 'charset', 'scheme'], true)) {
            return 'The native head reader consumes only the metadata name/property and content, leaving this attribute unused';
        }
        if ($fileType === 'wireframe') return 'The wireframe reader does not supply source attribution for this instruction';
        if ($fileType === 'custom') return 'Source grammar is outside the supported native layout schemas';
        if ($node === 'uiComponent' && $attribute === 'component') {
            return 'The native layout generator creates the component by name and does not pass this component attribute to its factory';
        }
        if ($attribute === 'output') {
            return 'The native layout automatically outputs root containers and does not use this output attribute to register blocks or containers';
        }
        if ($attribute === 'name' && $node === 'block') return 'Name participates in the block creation identity';
        if ($attribute === 'method' && $node === 'action') return 'Method participates in the identity of the parent action call';
        if ($attribute === 'remove' && in_array($node, ['referenceBlock', 'referenceContainer'], true)) {
            return 'The removal queue and its cancellations are unmeasured at this reference';
        }
        if ($attribute === 'display') return 'The display decision has no source trace at the element rendering boundary';
        if ($attribute === 'cacheable') return 'The native page-cache selector visits block declarations whose cacheable attribute is the literal false';
        if ($node === 'uiComponent' && $attribute === 'ttl') {
            return 'The native UI reader omits TTL and its generator does not apply this attribute to the wrapper';
        }
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
            $scopes = [];
            foreach ($file['declarations'] as $item) {
                $details = $item['layout'];
                $ordinal = $details['ordinal'];
                $kind = $details['kind'];
                if ($details['attribute'] === null) {
                    while ($scopes && !str_starts_with($item['path'], end($scopes)['path'] . '/')) array_pop($scopes);
                    $parent = end($scopes);
                    $nearest = $parent['nearest'] ?? null;
                    $owner = $parent['owner'] ?? null;
                    if ($nearest !== null) $targets[$nearest]['reference']['empty'] = false;
                    if (in_array($details['instruction'], ['block', 'container', 'uiComponent', 'referenceBlock', 'referenceContainer'], true)) {
                        $owner = null;
                    }
                    if ($item['supported'] && $kind === 'reference') {
                        $nearest = $owner = $ordinal;
                        $targets[$ordinal]['reference'] = ['id' => $item['id'], 'nameId' => null,
                            'element' => $details['element'], 'empty' => true, 'removeId' => null];
                    }
                    $scopes[] = ['path' => $item['path'], 'nearest' => $nearest, 'owner' => $owner];
                } else {
                    $scope = end($scopes);
                    $nearest = $scope['nearest'];
                    $owner = $scope['owner'];
                    if ($nearest !== null && $kind !== 'reference-name') $targets[$nearest]['reference']['empty'] = false;
                }
                if (!$item['supported'] && $kind !== 'file-selection') continue;
                $target = &$targets[$ordinal];
                $target['element'] = $details['element'];
                $target['instruction'] = $details['instruction'];
                $target['ids'][$kind] = $item['id'];
                if (isset($details['selection'])) $target['selection'] = $details['selection'];
                if ($kind === 'reference-name') $target['reference']['nameId'] = $item['id'];
                if ($kind === 'removal' && isset($target['reference'])) $target['reference']['removeId'] = $item['id'];
                if ($owner !== null && !in_array($kind, ['reference', 'reference-name'], true)) {
                    $target['referenceOwner'] = $targets[$owner]['reference']['id'];
                }
                unset($target);
            }
            if ($targets) $result[$file['path']] = ['hash' => $file['sourceHash'], 'targets' => $targets];
        }
        return $result;
    }
}
