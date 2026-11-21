<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Laminas\Permissions\Acl\Acl as LaminasAcl;
use Laminas\Permissions\Acl\Resource\GenericResource;
use Magento\Backend\Block\{AnchorRenderer, Menu as MenuBlock};
use Magento\Backend\Model\{Menu, Menu\Config as MenuConfig, Menu\Config\Reader as MenuReader, Menu\Item};
use Magento\Framework\{Acl, App\State, Authorization\Policy\Acl as AclPolicy, Config\Reader\Filesystem, View\Element\AbstractBlock};
use Magento\Framework\Acl\{AclResource, AclResource\Config\Reader\Filesystem as AclReader, AclResource\Provider, AclResource\ProviderInterface,
    AclResource\TreeBuilder, Loader\ResourceLoader};

final class AdminNavigationFamily
{
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
        if ($family === 'menu'
            && $dom->documentElement->getAttributeNS(self::XSI, 'noNamespaceSchemaLocation') !== self::MENU_SCHEMA) return [];
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
                    $ancestry = self::aclAncestry($tree, $identity);
                    if ($sources !== [[$nativePath, $item['node']]]) {
                        self::limit($item, 'Multiple material ACL declarations share the resource identity', 'ambiguous');
                    } elseif ($ancestry === null || $ancestry[$identity]['parent'] !== $item['binding']['parent']) {
                        self::limit($item, 'Resource or ancestor is disabled in the native ACL tree', 'disabled');
                    } else {
                        $targets['acl'][$identity] = ['id' => $item['id'], 'ancestry' => $ancestry];
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
                        'actionable' => in_array('menu-followed', $item['effects'], true),
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
            $bindings[$identity] = array_key_exists($identity, $bindings) ? null : $binding;
            foreach (self::aclBindings($node['children'] ?? [], $identity) as $id => $entry) {
                $bindings[$id] = array_key_exists($id, $bindings) ? null : $entry;
            }
        }
        return $bindings;
    }

    private static function aclAncestry(array $tree, string $identity): ?array
    {
        $ancestry = [];
        for ($id = $identity; $id !== null; $id = $tree[$id]['parent']) {
            if (!isset($tree[$id]) || isset($ancestry[$id])) return null;
            $ancestry[$id] = $tree[$id];
        }
        return $ancestry;
    }

    private static function aclParentsMatch(Acl $acl, array $ancestry, bool $evaluated = false): bool
    {
        // Read the exact resource tree used by Laminas without calling resource
        // getters, authorization assertions, or interceptors a second time.
        if (!self::native($acl, Acl::class)) return false;
        static $storage, $resourceId, $evaluatedResource;
        $storage ??= new \ReflectionProperty(LaminasAcl::class, 'resources');
        $resourceId ??= new \ReflectionProperty(GenericResource::class, 'resourceId');
        $evaluatedResource ??= new \ReflectionProperty(LaminasAcl::class, 'isAllowedResource');
        $resources = $storage->getValue($acl);
        if ($evaluated && $evaluatedResource->getValue($acl) !== ($resources[array_key_first($ancestry)]['instance'] ?? null)) {
            return false;
        }
        foreach ($ancestry as $id => ['parent' => $parent]) {
            $resource = $resources[$id] ?? [];
            $instance = $resource['instance'] ?? null;
            if (!is_object($instance) || !in_array(get_class($instance), [AclResource::class, GenericResource::class], true)
                || $resourceId->getValue($instance) !== $id || !array_key_exists('parent', $resource)) return false;
            $expectedParent = $parent === null ? null : ($resources[$parent]['instance'] ?? null);
            if ($resource['parent'] !== $expectedParent) return false;
        }
        return true;
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
                    $target = is_string($resource) ? ($observer->targets['acl'][$resource] ?? null) : null;
                    $frame = null;
                    if ($target !== null && $policy !== null && $observer->policies[$policy]['resource'] === $resource) {
                        $ancestry = $target['ancestry'];
                        $limit = match (true) {
                            self::aclAncestry($observer->aclTrees[$subject] ?? [], $resource) !== $ancestry => 'cache-only',
                            !self::aclParentsMatch($subject, $ancestry) => 'ambiguous',
                            default => null,
                        };
                        $frame = compact('policy', 'ancestry', 'limit');
                    }
                    $observer->aclEvaluations[] = $frame;
                },
                static function ($subject, array $args, $result, ?\Throwable $error, string $class) use ($observer): void {
                    if ($class !== LaminasAcl::class || !$subject instanceof Acl) return;
                    $frame = array_pop($observer->aclEvaluations);
                    if ($frame !== null) {
                        $completed = !$error && is_bool($result);
                        $limit = $frame['limit'];
                        if ($limit === null && $completed && !self::aclParentsMatch($subject, $frame['ancestry'], evaluated: true)) {
                            $limit = 'ambiguous';
                        }
                        $observer->policies[$frame['policy']]['test'] = ['result' => $completed ? $result : null,
                            'limit' => $limit];
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
                        $observer->blocks[] = ['subject' => $subject, 'rendered' => [], 'secretKeys' => []];
                    }
                },
                static function ($subject, array $args, $result, ?\Throwable $error, string $class) use ($observer): void {
                    $frame = $observer->blocks[array_key_last($observer->blocks)] ?? null;
                    if ($class !== AbstractBlock::class || $frame === null || $frame['subject'] !== $subject) return;
                    array_pop($observer->blocks);
                    if (!$error && is_string($result) && $result !== '') $observer->menuOutput($frame, $result);
                }],
            [MenuBlock::class, '_callbackSecretKey', null,
                static function ($subject, array $args, $result, ?\Throwable $error, string $class) use ($observer): void {
                    $index = array_key_last($observer->blocks);
                    if (!$error && $class === MenuBlock::class && $index !== null
                        && $observer->blocks[$index]['subject'] === $subject && is_string($result)) {
                        // Magento renders a cacheable placeholder and substitutes
                        // the session key in its native _afterToHtml callback.
                        $observer->blocks[$index]['secretKeys'][$args[0][0]] = $result;
                    }
                }],
            [AnchorRenderer::class, 'renderAnchor', null,
                static function ($subject, array $args, $result, ?\Throwable $error, string $class) use ($observer): void {
                    if (!$error && $class === AnchorRenderer::class && $observer->blocks && $args[1] instanceof Item && is_string($result)) {
                        $observer->menuAnchor($args[1], $result);
                    }
                }],
        ];
    }

    private function aclDecision(array $frame, bool $decision): void
    {
        $identity = $frame['resource'];
        if ($this->area !== 'adminhtml' || !is_string($identity) || !isset($this->targets['acl'][$identity])) return;
        $target = $this->targets['acl'][$identity];
        if ($frame['test'] === null) return;
        $limit = $frame['test']['limit'];
        if ($limit !== null) {
            Recorder::familyEvidence($target['id'], 'acl-check', $this->area, $limit,
                $limit === 'ambiguous' ? 'Effective ACL ancestry could not be verified against the original XML binding'
                    : 'Native ACL decision used a resource without matching original tree provenance');
            return;
        }
        if ($frame['test']['result'] === $decision) {
            Recorder::familyEvidence($target['id'], 'acl-check', $this->area, $decision ? 'allowed' : 'denied');
        }
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

    private function menuAnchor(Item $item, string $html): void
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
        // Capture the native rendered URL, including route defaults and all
        // parameters. Reading Item::getUrl again could rerun plugins.
        $href = $target['actionable'] && preg_match('/^<a href="([^"]*)"/', $html, $parts)
            ? html_entity_decode($parts[1], ENT_QUOTES | ENT_HTML5, 'UTF-8') : null;
        $this->blocks[array_key_last($this->blocks)]['rendered'][$identity][] = ['matches' => $matches, 'href' => $href];
    }

    private function menuOutput(array $frame, string $html): void
    {
        $dom = new \DOMDocument();
        if (!$dom->loadHTML($html, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING)) return;
        $xpath = new \DOMXPath($dom);
        $entries = [];
        foreach ($xpath->query('//li[@data-ui-id]') as $node) {
            $selector = $node->getAttribute('data-ui-id');
            $entries[$selector][] = $node;
        }
        $blockName = (new \ReflectionProperty(AbstractBlock::class, '_nameInLayout'))->getValue($frame['subject']);
        foreach ($this->targets['menu'] as $identity => $target) {
            $selector = self::uiId($blockName . '-' . $identity);
            $nodes = $entries[$selector] ?? [];
            if (!$nodes) continue;
            $rendered = $frame['rendered'][$identity] ?? [];
            if (count($nodes) === 1 && count($rendered) === 1 && $rendered[0]['matches']) {
                Recorder::familyEvidence($target['id'], 'menu-emitted', $this->area);
                $anchors = $xpath->query('./a[@href]', $nodes[0]);
                $href = $rendered[0]['href'];
                if ($href === null || $anchors->length !== 1) continue;
                $href = strtr($href, $frame['secretKeys']);
                if ($anchors->item(0)->getAttribute('href') === $href) {
                    $url = parse_url($href);
                    if (in_array($url['scheme'] ?? null, ['http', 'https'], true) && isset($url['host'], $url['path'])) {
                        $request = $url['path'] . (isset($url['query']) ? '?' . $url['query'] : '');
                        Recorder::menuLink($target['id'], $selector, hash('sha256', $request));
                    }
                }
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
