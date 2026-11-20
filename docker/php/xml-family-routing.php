<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\App\AreaList;
use Magento\Framework\App\Route\Config\Reader as RouteReader;
use Magento\Framework\Config\FileResolverInterface;
use Magento\Framework\Config\Reader\Filesystem;
use Magento\Framework\ObjectManager\ConfigInterface;
use Magento\Framework\ObjectManager\ConfigLoaderInterface;
use Magento\Webapi\Model\Config\Reader as WebapiReader;

require_once __DIR__ . '/xml-routing-runtime.php';

final class RoutingFamily
{
    private const AREAS = ['frontend' => 'standard', 'adminhtml' => 'admin'];
    private const ROUTE_EFFECTS = ['route-match', 'route-handler-entered'];
    private const WEBAPI_EFFECTS = ['webapi-match', 'webapi-permission', 'webapi-handler-entered'];

    public static function declarations(string $path, string $bytes): ?array
    {
        if (preg_match('~(?:^|/)etc/([^/]+)/routes\.xml$~', $path, $match)) {
            $dom = Xml::document($bytes);
            if (!self::schema($dom, 'config', 'urn:magento:framework:App/etc/routes.xsd')) return [];
            return self::httpDeclarations($path, $bytes, $dom, $match[1]);
        }
        if (!preg_match('~(?:^|/)etc/webapi\.xml$~', $path)) return null;
        $dom = Xml::document($bytes);
        if (!self::schema($dom, 'routes', 'urn:magento:module:Magento_Webapi:etc/webapi.xsd')) return [];
        return self::webDeclarations($path, $bytes, $dom);
    }

    private static function schema(\DOMDocument $dom, string $root, string $schema): bool
    {
        return $dom->documentElement->tagName === $root
            && $dom->documentElement->getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'noNamespaceSchemaLocation') === $schema;
    }

    private static function webDeclarations(string $path, string $bytes, \DOMDocument $dom): array
    {
        $ranges = Xml::ranges($bytes, $dom, true);
        $items = [];
        foreach ((new \DOMXPath($dom))->query('/routes/route') as $node) {
            $url = trim($node->getAttribute('url'));
            $normalized = '/' . trim($url, '/');
            $method = $node->getAttribute('method');
            $item = FamilyEvidence::declaration($path, 'webapi', $node, $ranges, "$method $normalized", self::WEBAPI_EFFECTS);
            if ($normalized !== $url || !preg_match('~^/V[0-9]+/~', $url)) {
                self::limit($item, 'Outside canonical synchronous REST paths');
            }
            $items[] = $item;
        }
        return $items;
    }

    private static function httpDeclarations(string $path, string $bytes, \DOMDocument $dom, string $area): array
    {
        $ranges = Xml::ranges($bytes, $dom, true);
        $items = [];
        foreach ((new \DOMXPath($dom))->query('/config/router/route') as $route) {
            $router = $route->parentNode->getAttribute('id');
            $identity = "$area/$router/" . $route->getAttribute('id');
            if ($route->hasAttribute('frontName')) {
                $items[] = FamilyEvidence::declaration($path, 'routes', $route, $ranges, $identity, self::ROUTE_EFFECTS);
            }
            foreach ($route->childNodes as $module) {
                if (!$module instanceof \DOMElement || $module->tagName !== 'module') continue;
                $owner = $identity . '/' . $module->getAttribute('name');
                $items[] = FamilyEvidence::declaration($path, 'routes', $module, $ranges, $owner, self::ROUTE_EFFECTS);
            }
        }
        return $items;
    }

    private static function limit(array &$item, string $reason, string $outcome = 'unsupported'): void
    {
        $item['supported'] = $item['effective'] = false;
        $item['reason'] = $reason;
        $item['outcome'] = $outcome;
    }

    public static function prepare($om, array &$files): array
    {
        $routes = [];
        $webapi = [];
        $providers = [];
        $areas = $om->get(AreaList::class);
        $requested = [];
        foreach ($files as $file) foreach ($file['declarations'] as $item) {
            if ($item['family'] === 'routes' && $item['supported']) $requested[$item['declaredScope']['type']] = true;
            if ($item['family'] === 'webapi' && $item['supported']) $requested['webapi_rest'] = true;
        }
        foreach (self::AREAS as $scope => $router) {
            if (!isset($requested[$scope]) || $areas->getDefaultRouter($scope) !== $router) continue;
            [$config, $origins, $hashes] = self::snapshot($om->get(RouteReader::class), 'routes.xml', $scope);
            $native = $config[$router]['routes'] ?? [];
            $routes[$scope] = ['config' => $native, 'origins' => $origins, 'providers' => $hashes];
            $providers += $hashes;
        }
        $webEnabled = isset($requested['webapi_rest']) && in_array('webapi_rest', $areas->getCodes(), true);
        if ($webEnabled) {
            [$webConfig, $webOrigins, $webHashes] = self::snapshot($om->get(WebapiReader::class), 'webapi.xml', 'global');
            $providers += $webHashes;
            $di = clone $om->get(ConfigInterface::class);
            $di->extend($om->get(ConfigLoaderInterface::class)->load('webapi_rest'));
        }

        $http = [];
        foreach ($files as $path => &$file) foreach ($file['declarations'] as &$item) {
            if (!in_array($item['family'], ['routes', 'webapi'], true) || !$item['supported']) continue;
            if ($item['family'] === 'routes') {
                self::prepareHttp($routes, $file['sourceHash'], $path, $item, $http);
                continue;
            }
            if (!$webEnabled) {
                self::limit($item, 'The native REST area is inactive in this installation');
                continue;
            }
            if (!self::source($item, $path, $file['sourceHash'], $webOrigins, $webHashes)) continue;
            [$verb, $url] = explode(' ', $item['path'], 2);
            $native = $webConfig['routes'][$url][$verb] ?? null;
            if ($native === null) {
                self::limit($item, 'Route is absent from the native REST configuration', 'displaced');
                continue;
            }
            ['class' => $service, 'method' => $method] = $native['service'];
            $implementation = $di->getInstanceType($di->getPreference($service));
            $handler = null;
            if (method_exists($implementation, $method)) {
                $callback = new \ReflectionMethod(ObserverManifest::nativeClass($implementation), $method);
                if ($callback->isPublic() && !$callback->isAbstract() && !$callback->isStatic()) $handler = $callback->class;
            }
            $webapi[$verb][$url] = ['id' => $item['id'], 'binding' => RoutingRuntime::webSignature(
                $service, $method, $native['secure'], array_keys($native['resources']),
                $native['parameters'], $native['input-array-size-limit']
            ), 'service' => $service, 'method' => $method, 'handler' => $handler, 'resources' => array_keys($native['resources'])];
        }
        unset($file, $item);
        return [['routes' => $http, 'webapi' => $webapi], $providers];
    }

    private static function prepareHttp(array $routes, string $hash, string $path, array &$item, array &$http): void
    {
        [$area, $router, $route, $module] = array_pad(explode('/', $item['path']), 4, null);
        if (!isset($routes[$area]) || self::AREAS[$area] !== $router) {
            self::limit($item, 'Outside the native storefront and Admin routers');
            return;
        }
        ['config' => $config, 'origins' => $origins, 'providers' => $providers] = $routes[$area];
        if (!self::source($item, $path, $hash, $origins, $providers)) return;
        $data = $config[$route] ?? [];
        if (!$data || ($module !== null && !in_array($module, $data['modules'], true))) {
            self::limit($item, 'Route or module is absent from the native router configuration', 'displaced');
            return;
        }
        $front = $data['frontName'];
        foreach ($config as $id => $candidate) {
            // Match the native lookup's front-name comparison, while keeping
            // route IDs such as "123" and "0123" distinct.
            if ($candidate['frontName'] != $front) continue;
            if (RoutingRuntime::identifier($id) !== $route) {
                self::limit($item, 'A preceding native route owns the same front name', 'displaced');
                return;
            }
            break;
        }
        $http[$area][$front] ??= ['route' => $route, 'hash' => RoutingRuntime::routeSignature($data)];
        $http[$area][$front]['ids'][$module ?? ''] = $item['id'];
    }

    private static function source(array &$item, string $path, string $hash, array $origins, array $providers): bool
    {
        $provider = BP . '/' . $path;
        if (($providers[$provider] ?? null) !== $hash) {
            self::limit($item, 'Original declaration is inactive in the installed native configuration reader');
        } elseif (($origins[$item['path']] ?? []) !== [$item['id']]) {
            self::limit($item, 'Multiple or unrecognized source declarations share the native binding', 'ambiguous');
        }
        return $item['supported'];
    }

    private static function snapshot(Filesystem $reader, string $filename, string $scope): array
    {
        // Replay the platform converter over precisely the bytes used for the
        // provider inventory. The application's reader and cache are untouched.
        $resolver = new \ReflectionProperty(Filesystem::class, '_fileResolver');
        $replay = clone $reader;
        $sources = new class implements FileResolverInterface {
            public array $files = [];
            public function get($filename, $scope = null) { return $this->files; }
        };
        $sources->files = iterator_to_array((function () use ($resolver, $reader, $filename, $scope) {
            yield from $resolver->getValue($reader)->get($filename, $scope);
        })());
        $resolver->setValue($replay, $sources);
        $native = $replay->read($scope);
        $origins = [];
        $hashes = [];
        foreach ($sources->files as $provider => $bytes) {
            $hashes[$provider] = hash('sha256', $bytes);
            $relative = str_starts_with($provider, BP . '/') ? substr($provider, strlen(BP) + 1) : $provider;
            // An out-of-scope XML overlay can still supply the selected
            // configuration even if its schema marker is absent or custom.
            $dom = Xml::document($bytes);
            $items = $filename === 'routes.xml' ? self::httpDeclarations($relative, $bytes, $dom, $scope)
                : self::webDeclarations($relative, $bytes, $dom);
            foreach ($items as $item) $origins[$item['path']][] = $item['id'];
        }
        return [$native, $origins, $hashes];
    }

    public static function hooks(array $targets): array
    {
        return (new RoutingRuntime($targets))->hooks();
    }
}
