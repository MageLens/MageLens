<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

namespace MageLens\XmlCoverage;

require_once __DIR__ . '/xml-ui-origin.php';
require_once __DIR__ . '/xml-ui-runtime.php';

final class UiFamily
{
    public const COMPONENT_CLASSES = [
        'column' => \Magento\Ui\Component\Listing\Columns\Column::class,
        'field' => \Magento\Ui\Component\Form\Field::class,
        'dataSource' => \Magento\Ui\Component\DataSource::class,
        'button' => \Magento\Ui\Component\Container::class,
    ];

    private const SCHEMA = 'urn:magento:module:Magento_Ui:etc/ui_configuration.xsd';
    private const XSI = 'http://www.w3.org/2001/XMLSchema-instance';

    public static function declarations(string $path, string $bytes): ?array
    {
        if (!preg_match('~/(?:view/(?:base|adminhtml)/|adminhtml/[^/]+/[^/]+/[^/]+/)ui_component/([A-Za-z0-9_-]+)\.xml$~D',
            $path, $match)) {
            return null;
        }
        $dom = Xml::document($bytes);
        $root = $dom->documentElement;
        if ($root->getAttributeNS(self::XSI, 'noNamespaceSchemaLocation') !== self::SCHEMA) return [];
        $ranges = Xml::ranges($bytes, $dom, true);
        $namespace = $match[1];
        $items = [];
        foreach ((new \DOMXPath($dom))->query('//field | //column | //dataSource | //button | //dataProvider | //settings/label') as $node) {
            $kind = match ($node->localName) {
                'label' => 'label',
                'dataProvider' => 'provider',
                default => 'component',
            };
            $component = match ($kind) {
                'label' => $node->parentNode->parentNode,
                'provider' => $node->parentNode,
                default => $node,
            };
            $type = $component->localName;
            if (!isset(self::COMPONENT_CLASSES[$type])) continue;
            if ($kind === 'label' && !in_array($type, ['field', 'column'], true)) continue;
            if ($kind === 'provider' && $type !== 'dataSource') continue;
            if ($type === 'button' && $component->parentNode->localName === 'buttons') continue;
            $segments = self::segments($component, $root);
            if ($segments === null) continue;
            $identity = implode('.', $type === 'dataSource' ? [$namespace, ...$segments] : [$namespace, $namespace, ...$segments]);
            $effects = self::effects($kind, $type, $root->localName);
            $item = FamilyEvidence::declaration($path, 'ui-component', $node, $ranges,
                $identity . ($kind === 'component' ? '' : '#' . $kind), $effects);
            $providerClass = $kind === 'provider' ? ltrim($node->getAttribute('class'), '\\') : null;
            $unsupported = match (true) {
                !in_array($root->localName, ['listing', 'form'], true) => 'Only native listing and form instances are measured',
                $root->hasAttribute('extends') => 'Extended UI component instances have unmeasured source ownership',
                $type === 'dataSource' && count($segments) !== 1 => 'Only root data sources have measured registry identities',
                $kind === 'provider' && !preg_match('~^[A-Za-z_][A-Za-z0-9_]*(?:\\\\[A-Za-z_][A-Za-z0-9_]*)+$~D', $providerClass)
                    => 'Provider requires a literal PHP class',
                $kind === 'label' && (new \DOMXPath($dom))->query(
                    './argument[@name="data"]/item[@name="config"]/item[@name="label"]', $component
                )->length > 0 => 'A legacy argument competes with the settings label',
                default => null,
            };
            $items[] = $item + ['ui' => [
                'namespace' => $namespace, 'segments' => $segments, 'type' => $type, 'kind' => $kind, 'providerClass' => $providerClass,
            ]];
            if ($unsupported !== null) {
                $index = array_key_last($items);
                $items[$index]['supported'] = false;
                $items[$index]['effective'] = false;
                $items[$index]['reason'] = $unsupported;
            }
        }
        return $items;
    }

    private static function segments(\DOMElement $component, \DOMElement $root): ?array
    {
        $segments = [];
        for ($node = $component; !$node->isSameNode($root); $node = $node->parentNode) {
            $name = $node->getAttribute('name');
            if (!preg_match('~^[A-Za-z0-9_-]+$~D', $name)) return null;
            array_unshift($segments, $name);
        }
        return $segments ?: null;
    }

    private static function effects(string $kind, string $type, string $root): array
    {
        if ($kind === 'provider') return $root === 'listing' ? ['ui-provider-executed', 'ui-reloaded'] : ['ui-provider-executed'];
        if ($kind === 'label') return ['ui-prepared', 'ui-delivered'];
        $effects = ['ui-created', 'ui-prepared', 'ui-delivered', 'ui-constructed'];
        if (in_array($type, ['column', 'field', 'button'], true)) $effects[] = 'ui-rendered';
        if ($type === 'button') $effects[] = 'ui-action-invoked';
        return $effects;
    }

    public static function prepare($om, array &$files): array
    {
        $targets = [];
        $providers = [];
        foreach ($files as $file) {
            foreach ($file['declarations'] as $item) {
                if ($item['family'] !== 'ui-component' || !$item['supported']) continue;
                $namespace = $item['ui']['namespace'];
                $targets[$namespace][$file['path']]['hash'] = $file['sourceHash'];
                $targets[$namespace][$file['path']]['items'][] = [
                    'id' => $item['id'], 'identity' => $item['path'], ...$item['ui'],
                ];
                if (defined('BP')) $providers[BP . '/' . $file['path']] = $file['sourceHash'];
            }
        }
        return [['instances' => $targets], $providers];
    }

    public static function hooks(array $targets): array
    {
        if (empty($targets['instances'])) return [];
        $origin = new UiOrigin($targets['instances'], $targets['run'] ?? null);
        $runtime = new UiRuntime($origin);
        return [...$origin->hooks(), ...$runtime->hooks()];
    }
}
