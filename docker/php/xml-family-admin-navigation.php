<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Laminas\Permissions\Acl\Acl as LaminasAcl;
use Magento\Backend\Block\{AnchorRenderer, Menu as MenuBlock};
use Magento\Backend\Model\{Menu, Menu\Config as MenuConfig, Menu\Config\Reader as MenuReader, Menu\Item};
use Magento\Framework\{Acl, App\State, Authorization\Policy\Acl as AclPolicy, Config\Reader\Filesystem, View\Element\AbstractBlock};
use Magento\Framework\Acl\{AclResource\Config\Reader\Filesystem as AclReader, AclResource\Provider, AclResource\ProviderInterface,
    AclResource\TreeBuilder, Loader\ResourceLoader};

final class AdminNavigationFamily
{
    private const ACL_SCHEMA = 'urn:magento:framework:Acl/etc/acl.xsd';
    private const MENU_SCHEMA = 'urn:magento:module:Magento_Backend:etc/menu.xsd';
    private const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
    private const MENU_PROPERTIES = [
        'action' => '_action',
        'resource' => '_resource',
        'module' => '_moduleName',
        'title' => '_title',
        'toolTip' => '_tooltip',
        'dependsOnModule' => '_dependsOnModule',
        'dependsOnConfig' => '_dependsOnConfig',
        'target' => 'target',
    ];

    private array $policies = [];
    private array $aclEvaluations = [];
    private array $resourceLoaders = [];
    private array $blocks = [];
    private \WeakMap $aclTrees;
    private \WeakMap $menuEntries;
    private string $area = '';

    private function __construct(private array $targets)
    {
        $this->aclTrees = new \WeakMap();
        $this->menuEntries = new \WeakMap();
    }

    public static function declarations(string $path, string $bytes): ?array
    {
        $family = match (true) {
            str_ends_with($path, '/etc/acl.xml') => 'acl',
            str_ends_with($path, '/etc/adminhtml/menu.xml') => 'menu',
            default => null,
        };
        if ($family === null) return null;
        $dom = Xml::document($bytes);
        $schema = $family === 'acl' ? self::ACL_SCHEMA : self::MENU_SCHEMA;
        if ($dom->documentElement->getAttributeNS(self::XSI, 'noNamespaceSchemaLocation') !== $schema) return [];
        $ranges = Xml::ranges($bytes, $dom, true);
        $query = $family === 'acl' ? '/config/acl/resources//resource' : '/config/menu/*';
        $declarations = [];
        foreach ((new \DOMXPath($dom))->query($query) as $node) {
            $identity = $node->getAttribute('id');
            if ($identity === '') continue;
            $action = $node->getAttribute('action');
            $effects = $family === 'acl' ? ['acl-check'] : ['menu-emitted'];
            if ($family === 'menu' && $node->tagName === 'add' && $action !== '') $effects[] = 'menu-followed';
            $item = FamilyEvidence::declaration($path, $family, $node, $ranges, $identity, $effects);
            if ($family === 'acl') {
                $parent = $node->parentNode->nodeName === 'resource' ? $node->parentNode->getAttribute('id') : null;
                $item['binding'] = ['id' => $identity, 'parent' => $parent];
                if ($node->attributes->length === 1) {
                    self::limit($item, 'Structural ACL reference to a resource declared elsewhere');
                }
            } else {
                $item['binding'] = ['id' => $identity, 'action' => $action, 'command' => $node->tagName];
                if ($node->tagName !== 'add') {
                    self::limit($item, 'Menu update and remove commands have no independently attributed output');
                }
            }
            $declarations[] = $item;
        }
        return $declarations;
    }

    private static function limit(array &$item, string $reason, string $outcome = 'unsupported'): void
    {
        $item['supported'] = false;
        $item['effective'] = false;
        $item['reason'] = $reason;
        $item['outcome'] = $outcome;
    }

    public static function prepare($om, array &$files): array
    {
        $aclProvider = $om->get(ProviderInterface::class);
        $menuConfig = $om->get(MenuConfig::class);
        $aclReader = self::native($aclProvider, Provider::class)
            ? (new \ReflectionProperty(Provider::class, '_configReader'))->getValue($aclProvider) : null;
        $menuReader = self::native($menuConfig, MenuConfig::class)
            ? (new \ReflectionProperty(MenuConfig::class, '_configReader'))->getValue($menuConfig) : null;
        $acl = self::native($aclReader, AclReader::class) ? self::sources($aclReader, 'global') : [];
        $menu = self::native($menuReader, MenuReader::class) ? self::sources($menuReader, 'adminhtml') : [];
        $hashes = array_map(static fn(string $bytes): string => hash('sha256', $bytes), $acl + $menu);

        $definitions = [];
        foreach ($acl as $source => $bytes) {
            foreach (self::declarations($source, $bytes) as $candidate) {
                if ($candidate['supported']) $definitions[$candidate['path']][] = [$source, $candidate['node']];
            }
        }
        $resources = $acl ? $aclReader->read('global')['config']['acl']['resources'] ?? [] : [];
        $tree = self::aclBindings((new TreeBuilder())->build($resources));
        $commands = [];
        foreach ($menu ? $menuReader->read('adminhtml') : [] as $command) $commands[$command['id']][] = $command;
        $selectors = [];
        foreach (array_keys($commands) as $identity) {
            $selector = self::uiId($identity);
            $selectors[$selector] = ($selectors[$selector] ?? 0) + 1;
        }

        $targets = ['acl' => [], 'menu' => []];
        foreach ($files as $path => &$file) {
            $family = $file['family'];
            if (!isset($targets[$family])) continue;
            $nativePath = BP . '/' . $path;
            foreach ($file['declarations'] as &$item) {
                if (!$item['supported']) continue;
                if (($hashes[$nativePath] ?? null) !== $file['sourceHash']) {
                    self::limit($item, 'Original source was not read by the native Admin configuration reader');
                    continue;
                }
                $identity = $item['path'];
                if ($family === 'acl') {
                    $sources = $definitions[$identity] ?? [];
                    if ($sources !== [[$nativePath, $item['node']]]) {
                        self::limit($item, 'Multiple material ACL declarations share the resource identity', 'ambiguous');
                    } elseif (!isset($tree[$identity]) || $tree[$identity]['parent'] !== $item['binding']['parent']) {
                        self::limit($item, 'Resource or ancestor is disabled in the native ACL tree', 'disabled');
                    } else {
                        $targets['acl'][$identity] = ['id' => $item['id'], 'binding' => $tree[$identity]];
                    }
                    continue;
                }
                $matching = $commands[$identity] ?? [];
                $types = array_column($matching, 'type');
                if ($types !== ['add']) {
                    $reason = match (true) {
                        in_array('remove', $types, true) => 'Native menu remove command displaced this entry',
                        in_array('update', $types, true) => 'Native menu update creates multiple sources for this entry',
                        default => 'Native menu entry has no unique add command',
                    };
                    self::limit($item, $reason, in_array('remove', $types, true) ? 'displaced' : 'ambiguous');
                } elseif ($selectors[self::uiId($identity)] !== 1) {
                    self::limit($item, 'Multiple native menu identities have the same rendered identifier', 'ambiguous');
                } elseif (self::menuAncestorRemoved($matching[0], $commands)) {
                    self::limit($item, 'Native menu remove command displaced an ancestor of this entry', 'displaced');
                } else {
                    $params = $matching[0];
                    $targets['menu'][$identity] = ['id' => $item['id'], 'parent' => $params['parent'] ?? null,
                        'properties' => array_intersect_key($params, self::MENU_PROPERTIES)];
                }
            }
            unset($item);
        }
        unset($file);
        foreach ($targets as &$entries) ksort($entries);
        return [$targets, $hashes];
    }

    private static function native(mixed $subject, string $class): bool
    {
        return is_object($subject) && in_array(get_class($subject), [$class, $class . '\\Interceptor'], true);
    }

    private static function sources(Filesystem $reader, string $area): array
    {
        $resolver = (new \ReflectionProperty(Filesystem::class, '_fileResolver'))->getValue($reader);
        $filename = (new \ReflectionProperty(Filesystem::class, '_fileName'))->getValue($reader);
        $sources = [];
        foreach ($resolver->get($filename, $area) as $path => $bytes) $sources[$path] = $bytes;
        return $sources;
    }

    private static function aclBindings(array $nodes, ?string $parent = null): array
    {
        $bindings = [];
        foreach ($nodes as $node) {
            $identity = $node['id'];
            $metadata = $node;
            unset($metadata['children']);
            $binding = ['parent' => $parent, 'metadata' => hash('sha256', Xml::canonical($metadata))];
            $children = self::aclBindings($node['children'] ?? [], $identity);
            foreach ([$identity => $binding] + $children as $id => $entry) {
                $bindings[$id] = array_key_exists($id, $bindings) ? null : $entry;
            }
        }
        return $bindings;
    }

    private static function menuAncestorRemoved(array $command, array $commands): bool
    {
        $seen = [];
        while (($parent = $command['parent'] ?? null) !== null && isset($commands[$parent]) && !isset($seen[$parent])) {
            $seen[$parent] = true;
            $command = [];
            foreach ($commands[$parent] as $next) {
                if ($next['type'] === 'remove') return true;
                $command = array_replace($command, $next);
            }
        }
        return false;
    }

    private static function uiId(string $value): string
    {
        return trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($value)), '-');
    }

    public static function hooks(array $targets): array
    {
        $observer = new self($targets);
        return [
            [State::class, 'setAreaCode', null,
                static function ($subject, array $args, $result, ?\Throwable $error, string $class) use ($observer): void {
                    if (!$error && $class === State::class) $observer->area = $args[0];
                }],
            [ResourceLoader::class, 'populateAcl',
                static function ($subject, array $args, string $class) use ($observer): void {
                    if ($class === ResourceLoader::class) $observer->resourceLoaders[] = null;
                },
                static function ($subject, array $args, $result, ?\Throwable $error, string $class) use ($observer): void {
                    if ($class !== ResourceLoader::class) return;
                    $tree = array_pop($observer->resourceLoaders);
                    if (!$error && $tree !== null) $observer->aclTrees[$args[0]] = $tree;
                }],
            [Provider::class, 'getAclResources', null,
                static function ($subject, array $args, $result, ?\Throwable $error, string $class) use ($observer): void {
                    if (!$error && $class === Provider::class && $observer->resourceLoaders && is_array($result)) {
                        $observer->resourceLoaders[array_key_last($observer->resourceLoaders)] = self::aclBindings($result);
                    }
                }],
            [AclPolicy::class, 'isAllowed',
                static function ($subject, array $args, string $class) use ($observer): void {
                    if ($class === AclPolicy::class) $observer->policies[] = ['resource' => $args[1], 'test' => null];
                },
                static function ($subject, array $args, $result, ?\Throwable $error, string $class) use ($observer): void {
                    if ($class !== AclPolicy::class) return;
                    $frame = array_pop($observer->policies);
                    if (!$error && is_bool($result)) $observer->aclDecision($frame, $result);
                }],
            [LaminasAcl::class, 'isAllowed',
                static function ($subject, array $args, string $class) use ($observer): void {
                    if ($class !== LaminasAcl::class || !$subject instanceof Acl) return;
                    // The evaluator replaces the original string argument with
                    // a resource object and can walk up to its native parent.
                    $resource = $args[1] ?? null;
                    $policy = array_key_last($observer->policies);
                    $observer->aclEvaluations[] = is_string($resource) && isset($observer->targets['acl'][$resource])
                        && $policy !== null && $observer->policies[$policy]['resource'] === $resource ? $policy : null;
                },
                static function ($subject, array $args, $result, ?\Throwable $error, string $class) use ($observer): void {
                    if ($class !== LaminasAcl::class || !$subject instanceof Acl) return;
                    $policy = array_pop($observer->aclEvaluations);
                    if ($policy !== null && !$error && is_bool($result)) {
                        $observer->policies[$policy]['test'] = ['result' => $result, 'tree' => $observer->aclTrees[$subject] ?? []];
                    }
                }],
            [MenuConfig::class, 'getMenu', null,
                static function ($subject, array $args, $result, ?\Throwable $error, string $class) use ($observer): void {
                    if (!$error && $class === MenuConfig::class && $observer->area === 'adminhtml' && $result instanceof Menu) {
                        $observer->rememberMenu($result);
                    }
                }],
            [AbstractBlock::class, 'toHtml',
                static function ($subject, array $args, string $class) use ($observer): void {
                    if ($class === AbstractBlock::class && self::native($subject, MenuBlock::class) && $observer->area === 'adminhtml') {
                        $observer->blocks[] = ['subject' => $subject, 'rendered' => []];
                    }
                },
                static function ($subject, array $args, $result, ?\Throwable $error, string $class) use ($observer): void {
                    $frame = $observer->blocks[array_key_last($observer->blocks)] ?? null;
                    if ($class !== AbstractBlock::class || $frame === null || $frame['subject'] !== $subject) return;
                    array_pop($observer->blocks);
                    if (!$error && is_string($result) && $result !== '') $observer->menuOutput($frame, $result);
                }],
            [AnchorRenderer::class, 'renderAnchor', null,
                static function ($subject, array $args, $result, ?\Throwable $error, string $class) use ($observer): void {
                    if (!$error && $class === AnchorRenderer::class && $observer->blocks && $args[1] instanceof Item) {
                        $observer->menuAnchor($args[1]);
                    }
                }],
        ];
    }

    private function aclDecision(array $frame, bool $decision): void
    {
        $identity = $frame['resource'];
        if ($this->area !== 'adminhtml' || !is_string($identity) || !isset($this->targets['acl'][$identity])) return;
        $target = $this->targets['acl'][$identity];
        if ($frame['test'] === null || $frame['test']['result'] !== $decision) return;
        $actual = $frame['test']['tree'][$identity] ?? null;
        if ($actual !== $target['binding']) {
            Recorder::familyEvidence($target['id'], 'acl-check', $this->area, 'cache-only',
                'Native ACL decision used a resource without matching original tree provenance');
            return;
        }
        Recorder::familyEvidence($target['id'], 'acl-check', $this->area, $decision ? 'allowed' : 'denied');
    }

    private function rememberMenu(Menu $menu, ?string $parent = null): void
    {
        $id = new \ReflectionProperty(Item::class, '_id');
        $submenu = new \ReflectionProperty(Item::class, '_submenu');
        foreach ($menu->getArrayCopy() as $item) {
            if (!$item instanceof Item) continue;
            $identity = $id->getValue($item);
            $this->menuEntries[$item] = ['id' => $identity, 'parent' => $parent];
            $children = $submenu->getValue($item);
            if ($children instanceof Menu) $this->rememberMenu($children, $identity);
        }
    }

    private function menuAnchor(Item $item): void
    {
        $identity = (new \ReflectionProperty(Item::class, '_id'))->getValue($item);
        $target = $this->targets['menu'][$identity] ?? null;
        if ($target === null) return;
        $location = $this->menuEntries[$item] ?? null;
        $matches = $location === ['id' => $identity, 'parent' => $target['parent']];
        foreach (self::MENU_PROPERTIES as $attribute => $property) {
            if ((new \ReflectionProperty(Item::class, $property))->getValue($item) !== ($target['properties'][$attribute] ?? null)) {
                $matches = false;
            }
        }
        $this->blocks[array_key_last($this->blocks)]['rendered'][$identity][] = $matches;
    }

    private function menuOutput(array $frame, string $html): void
    {
        $dom = new \DOMDocument();
        if (!$dom->loadHTML($html, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING)) return;
        $entries = [];
        foreach ((new \DOMXPath($dom))->query('//li[@data-ui-id]') as $node) {
            $selector = $node->getAttribute('data-ui-id');
            $entries[$selector] = ($entries[$selector] ?? 0) + 1;
        }
        $blockName = (new \ReflectionProperty(AbstractBlock::class, '_nameInLayout'))->getValue($frame['subject']);
        foreach ($this->targets['menu'] as $identity => $target) {
            $count = $entries[self::uiId($blockName . '-' . $identity)] ?? 0;
            if ($count === 0) continue;
            $rendered = $frame['rendered'][$identity] ?? [];
            if ($count === 1 && $rendered === [true]) {
                Recorder::familyEvidence($target['id'], 'menu-emitted', $this->area);
            } elseif (!$rendered) {
                Recorder::familyEvidence($target['id'], 'menu-emitted', $this->area, 'cache-only',
                    'Menu markup was reused without a native item render in this response');
            } else {
                Recorder::familyEvidence($target['id'], 'menu-emitted', $this->area, 'ambiguous',
                    'Native rendered menu item or markup did not uniquely match the original command');
            }
        }
    }
}
