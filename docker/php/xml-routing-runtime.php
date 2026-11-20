<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Backend\App\Router as AdminRouter;
use Magento\Framework\App\ActionInterface;
use Magento\Framework\App\FrontController;
use Magento\Framework\App\Request\Http;
use Magento\Framework\App\Route\Config as RouteConfig;
use Magento\Framework\App\Router\Base;
use Magento\Framework\Exception\AuthorizationException;
use Magento\Framework\HTTP\PhpEnvironment\Request as PhpRequest;
use Magento\Framework\ObjectManagerInterface;
use Magento\Framework\Webapi\Rest\Request as RestRequest;
use Magento\Webapi\Controller\Rest as RestController;
use Magento\Webapi\Controller\Rest\InputParamsResolver;
use Magento\Webapi\Controller\Rest\RequestValidator;
use Magento\Webapi\Controller\Rest\Router as RestRouter;
use Magento\Webapi\Controller\Rest\Router\Route as RestRoute;
use Magento\Webapi\Controller\Rest\SynchronousRequestProcessor;
use Magento\Webapi\Model\Rest\Config as RestConfig;

final class RoutingRuntime
{
    private \WeakMap $actions;
    private array $routeStack = [];
    private array $dispatchStack = [];
    private array $rest = [];
    private array $matches = [];

    public function __construct(private readonly array $targets)
    {
        $this->actions = new \WeakMap();
    }

    public function hooks(): array
    {
        $hooks = [];
        if ($this->targets['routes']) {
            $hooks = [
                [Base::class, 'matchAction',
                    function ($router, array $params, string $class): void {
                        if ($class !== Base::class) return;
                        $area = match (get_class($router)) {
                            Base::class, Base::class . '\\Interceptor' => 'frontend',
                            AdminRouter::class, AdminRouter::class . '\\Interceptor' => 'adminhtml',
                            default => null,
                        };
                        $this->routeStack[] = ['area' => $area, 'config' => []];
                    },
                    function ($router, array $params, $result, ?\Throwable $error, string $class): void {
                        if ($class !== Base::class) return;
                        $match = array_pop($this->routeStack);
                        if (!$error && $result instanceof ActionInterface && $params[0] instanceof Http) {
                            $this->routeMatch($match, $params[0], $result);
                        }
                    }],
                [RouteConfig::class, '_getRoutes', null,
                    function ($config, array $params, $result, ?\Throwable $error, string $class): void {
                        $index = array_key_last($this->routeStack);
                        if ($index !== null && !$error && $class === RouteConfig::class && is_array($result)) {
                            $this->routeStack[$index]['config'] = $result;
                        }
                    }],
                [FrontController::class, 'getActionResponse',
                    function ($controller, array $params, string $class): void {
                        if ($class !== FrontController::class) return;
                        $this->dispatchStack[] = ['action' => $params[0], 'entered' => false];
                    },
                    function ($controller, array $params, $result, ?\Throwable $error, string $class): void {
                        if ($class === FrontController::class) array_pop($this->dispatchStack);
                    }],
                [ActionInterface::class, 'execute', null,
                    function ($action, array $params, $result, ?\Throwable $error, string $class, string $name, string $file, int $line): void {
                        $index = array_key_last($this->dispatchStack);
                        if ($index === null || !isset($this->actions[$action]) || str_ends_with($class, '\\Interceptor')) return;
                        $dispatch =& $this->dispatchStack[$index];
                        if ($dispatch['action'] !== $action || $dispatch['entered']) return;
                        $dispatch['entered'] = true;
                        [$area, $ids] = $this->actions[$action];
                        $this->handlerEntry($ids, 'route-handler-entered', $area, $error, $file, $line);
                    }],
            ];
        }
        if (!$this->targets['webapi']) return $hooks;

        $hooks = [...$hooks, ...$this->restHooks()];
        $callbacks = [];
        foreach ($this->targets['webapi'] as $routes) foreach ($routes as $route) {
            if ($route['handler'] !== null) $callbacks[$route['handler']][$route['method']] = true;
        }
        foreach ($callbacks as $handler => $methods) foreach ($methods as $method => $unused) {
            $hooks[] = [$handler, $method, null,
                function ($subject, array $params, $result, ?\Throwable $error, string $class, string $name, string $file, int $line) use ($handler, $method): void {
                    if ($class === $handler) $this->restHandler($subject, $class, $method, $error, $file, $line);
                }];
        }
        return $hooks;
    }

    private function restHooks(): array
    {
        return [
            [RestController::class, 'dispatch',
                function ($controller, array $params, string $class): void {
                    if ($class !== RestController::class) return;
                    [$request] = self::properties($controller, RestController::class, ['_request']);
                    $this->rest[] = ['request' => $request, 'routes' => new \WeakMap(), 'policies' => new \WeakMap(),
                        'allowed' => [], 'selected' => null, 'service' => null, 'entered' => false, 'processors' => 0];
                },
                function ($controller, array $params, $result, ?\Throwable $error, string $class): void {
                    if ($class === RestController::class) array_pop($this->rest);
                }],
            [SynchronousRequestProcessor::class, 'process',
                function ($processor, array $params, string $class): void {
                    $index = array_key_last($this->rest);
                    if ($index !== null && $class === SynchronousRequestProcessor::class) $this->rest[$index]['processors']++;
                },
                function ($processor, array $params, $result, ?\Throwable $error, string $class): void {
                    $index = array_key_last($this->rest);
                    if ($index !== null && $class === SynchronousRequestProcessor::class) $this->rest[$index]['processors']--;
                }],
            [RestRouter::class, 'match',
                function ($router, array $params, string $class): void {
                    if ($class === RestRouter::class) $this->matches[] = ['request' => $params[0], 'verbs' => []];
                },
                function ($router, array $params, $result, ?\Throwable $error, string $class): void {
                    if ($class !== RestRouter::class) return;
                    $match = array_pop($this->matches);
                    if (!$error && $result instanceof RestRoute) $this->restMatch($match, $result);
                }],
            [RestRequest::class, 'getHttpMethod', null,
                function ($request, array $params, $result, ?\Throwable $error): void {
                    $index = array_key_last($this->matches);
                    if ($index === null || $this->matches[$index]['request'] !== $request || $error || !is_string($result)) return;
                    if (self::calledBy('getHttpMethod', RestConfig::class, 'getRestRoutes')) {
                        $this->matches[$index]['verbs'][$result] = true;
                    }
                }],
            [RestRoute::class, 'getAclResources', null,
                function ($route, array $params, $result, ?\Throwable $error): void {
                    $index = array_key_last($this->rest);
                    if ($index === null || $error || !self::calledBy('getAclResources', RequestValidator::class, 'checkPermissions')) return;
                    $target = $this->rest[$index]['routes'][$route] ?? null;
                    if ($target !== null) $this->rest[$index]['policies'][$route] = $target['resources'] === $result;
                }],
            [RequestValidator::class, 'checkPermissions', null,
                function ($validator, array $params, $result, ?\Throwable $error, string $class, string $name, string $file): void {
                    if ($class === RequestValidator::class) $this->restPermission($params[0], $error, $file);
                }],
            [InputParamsResolver::class, 'getRoute', null,
                function ($resolver, array $params, $result, ?\Throwable $error): void {
                    $index = array_key_last($this->rest);
                    if ($index === null || $this->rest[$index]['processors'] === 0 || $error || !$result instanceof RestRoute) return;
                    if (self::calledBy('getRoute', SynchronousRequestProcessor::class, 'process')) {
                        $this->rest[$index]['selected'] = $this->rest[$index]['routes'][$result] ?? null;
                    }
                }],
            [RestRoute::class, 'getServiceMethod', null,
                function ($route, array $params, $result, ?\Throwable $error): void {
                    $index = array_key_last($this->rest);
                    if ($index === null || $error || !self::calledBy('getServiceMethod', SynchronousRequestProcessor::class, 'process')) return;
                    $selected = $this->rest[$index]['selected'];
                    if ($selected === null || $selected['method'] === $result) return;
                    Recorder::familyEvidence($selected['id'], 'webapi-handler-entered', 'webapi_rest', 'displaced',
                        'Runtime code changed the selected REST service method');
                    $this->rest[$index]['selected'] = null;
                }],
            [ObjectManagerInterface::class, 'get', null,
                function ($manager, array $params, $result, ?\Throwable $error): void {
                    $index = array_key_last($this->rest);
                    if ($index === null || $error || !is_object($result)) return;
                    $selected = $this->rest[$index]['selected'];
                    if ($selected === null || !self::calledBy('get', SynchronousRequestProcessor::class, 'process')) return;
                    if ($selected['service'] !== $params[0]) {
                        Recorder::familyEvidence($selected['id'], 'webapi-handler-entered', 'webapi_rest', 'displaced',
                            'Runtime code changed the selected REST service class');
                        return;
                    }
                    $handler = $selected['handler'];
                    if ($handler === null || !$result instanceof $handler) {
                        Recorder::familyEvidence($selected['id'], 'webapi-handler-entered', 'webapi_rest', 'ambiguous',
                            'The native service instance does not match the prepared implementation');
                        return;
                    }
                    $this->rest[$index]['service'] = $result;
                }],
        ];
    }

    private function routeMatch(array $match, Http $request, ActionInterface $action): void
    {
        $area = $match['area'];
        [$route, $module] = self::properties($request, Http::class, ['route', 'controllerModule']);
        [$actionName] = self::properties($request, PhpRequest::class, ['action']);
        if ($area === null || !is_string($route) || !$module || $actionName === Base::NO_ROUTE) return;
        $target = $this->targets['routes'][$area][$route] ?? null;
        if ($target === null) return;
        $ids = array_values(array_intersect_key($target['ids'], [$module => true, '' => true]));
        if (!$ids) return;
        if (self::routeSignature($match['config'][$route] ?? []) !== $target['hash']) {
            foreach ($ids as $id) Recorder::familyEvidence($id, 'route-match', $area, 'cache-only',
                'The native route configuration differs from the current source binding');
            return;
        }
        foreach ($ids as $id) Recorder::familyEvidence($id, 'route-match', $area, 'matched');
        $this->actions[$action] = [$area, $ids];
    }

    private function restMatch(array $match, RestRoute $route): void
    {
        $index = array_key_last($this->rest);
        if ($index === null) return;
        $request = $this->rest[$index]['request'];
        // Webapi can inject its request as a generated shared proxy while the
        // native route validator receives the same underlying request object.
        if ($request instanceof RestRequest\Proxy) {
            [$request] = self::properties($request, RestRequest\Proxy::class, ['_subject']);
        }
        if ($request !== $match['request'] || !$request instanceof RestRequest) return;
        [$requestPath] = self::properties($request, PhpRequest::class, ['pathInfo']);
        if (preg_match(SynchronousRequestProcessor::PROCESSOR_PATH, $requestPath) !== 1) return;
        [$path, $service, $method, $secure, $resources, $parameters, $limit] = self::properties($route, RestRoute::class,
            ['route', 'serviceClass', 'serviceMethod', 'secure', 'aclResources', 'parameters', 'inputArraySizeLimit']);
        $path = '/' . $path;
        if (count($match['verbs']) !== 1) {
            foreach ($this->targets['webapi'] as $verb => $routes) if (isset($routes[$path])) {
                Recorder::familyEvidence($routes[$path]['id'], 'webapi-match', 'webapi_rest', 'ambiguous',
                    'Cannot establish the HTTP method used by the native REST route reader');
            }
            return;
        }
        $target = $this->targets['webapi'][array_key_first($match['verbs'])][$path] ?? null;
        if ($target === null) return;
        if (self::webSignature($service, $method, $secure, $resources, $parameters, $limit) !== $target['binding']) {
            Recorder::familyEvidence($target['id'], 'webapi-match', 'webapi_rest', 'cache-only',
                'The native REST route differs from the current source binding');
            return;
        }
        $this->rest[$index]['routes'][$route] = $target;
        Recorder::familyEvidence($target['id'], 'webapi-match', 'webapi_rest', 'matched');
    }

    private function restPermission(RestRoute $route, ?\Throwable $error, string $file): void
    {
        $index = array_key_last($this->rest);
        if ($index === null) return;
        $target = $this->rest[$index]['routes'][$route] ?? null;
        if ($target === null) return;
        $id = $target['id'];
        if (($this->rest[$index]['policies'][$route] ?? null) !== true) {
            Recorder::familyEvidence($id, 'webapi-permission', 'webapi_rest', 'ambiguous',
                'The ACL resource list used by native permission validation could not be attributed');
            return;
        }
        if ($error === null) {
            $this->rest[$index]['allowed'][$id] = true;
            Recorder::familyEvidence($id, 'webapi-permission', 'webapi_rest', 'allowed');
        } elseif ($error instanceof AuthorizationException && $error->getFile() === $file) {
            Recorder::familyEvidence($id, 'webapi-permission', 'webapi_rest', 'denied');
        } else {
            Recorder::familyEvidence($id, 'webapi-permission', 'webapi_rest', 'ambiguous',
                'Authorization did not return a native permission decision');
        }
    }

    private function restHandler($subject, string $class, string $method, ?\Throwable $error, string $file, int $line): void
    {
        $index = array_key_last($this->rest);
        if ($index === null) return;
        $request =& $this->rest[$index];
        $target = $request['selected'];
        if ($target === null || $request['entered'] || $request['service'] !== $subject || $target['handler'] !== $class
            || $target['method'] !== $method || !isset($request['allowed'][$target['id']])) return;
        $request['entered'] = true;
        $this->handlerEntry([$target['id']], 'webapi-handler-entered', 'webapi_rest', $error, $file, $line);
    }

    private function handlerEntry(array $ids, string $effect, string $area, ?\Throwable $error, string $file, int $line): void
    {
        $ambiguous = $error instanceof \TypeError && $error->getFile() === $file && $error->getLine() === $line;
        foreach ($ids as $id) {
            Recorder::familyEvidence($id, $effect, $area, $ambiguous ? 'ambiguous' : 'entered',
                $ambiguous ? 'PHP could not establish entry after a TypeError at the handler declaration' : null);
        }
    }

    private static function calledBy(string $method, string $caller, string $callerMethod): bool
    {
        $frames = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 10);
        foreach ($frames as $index => $frame) {
            if ($frame['function'] !== $method || !isset($frame['class'])) continue;
            $next = $frames[$index + 1] ?? [];
            if (($next['class'] ?? null) === $caller && $next['function'] === $callerMethod) return true;
            // A generated interceptor can delegate the same method to its
            // parent. Follow the adjacent frames up to the native caller.
            if (($next['function'] ?? null) !== $method || !str_ends_with($next['class'] ?? '', '\\Interceptor')) return false;
        }
        return false;
    }

    private static function properties(object $object, string $class, array $names): array
    {
        static $properties = [];
        $values = [];
        foreach ($names as $name) {
            $property = $properties[$class][$name] ??= new \ReflectionProperty($class, $name);
            $values[] = $property->getValue($object);
        }
        return $values;
    }

    public static function routeSignature(array $route): string
    {
        return hash('sha256', Xml::canonical($route));
    }

    public static function webSignature(string $service, string $method, bool $secure, array $resources, array $data, ?int $limit): string
    {
        return hash('sha256', Xml::canonical([$service, $method, $secure, $resources, $data, $limit]));
    }
}
