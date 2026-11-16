<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

final class Recorder
{
    private static ?array $manifest = null;
    private static array $events = [];
    private static array $errors = [];
    private static array $fieldSources = [];
    private static array $accessors = [];
    private static bool $busy = false;
    private static bool $readHook = false;
    private static bool $renderHook = false;

    public static function start(string $run): void
    {
        self::$manifest = json_decode(file_get_contents('/coverage/xml-collector.json'), true, flags: JSON_THROW_ON_ERROR);
        if (self::$manifest['run'] !== $run) throw new \RuntimeException('Stale XML manifest');
    }
    public static function observerTargets(): array
    {
        return self::$manifest['observers'] ?? [];
    }
    public static function observer(string $id, string $area, string $event, string $observer): void
    {
        $key = "$id\0observer-execute\0$area";
        self::$events[$key] = ['id' => $id, 'type' => 'observer-execute', 'area' => $area,
            'registration' => ['event' => $event, 'observer' => $observer], 'hits' => (self::$events[$key]['hits'] ?? 0) + 1];
    }
    public static function pluginTargets(): array
    {
        return self::$manifest['plugins'] ?? [];
    }
    public static function plugin(string $id, string $area, string $name, array $callback): void
    {
        $key = "$id\0plugin-execute\0$area\0" . PluginManifest::callbackKey($callback);
        self::$events[$key] = ['id' => $id, 'type' => 'plugin-execute', 'area' => $area, 'name' => $name,
            'callback' => $callback, 'hits' => (self::$events[$key]['hits'] ?? 0) + 1];
    }
    public static function mutation(): void
    {
        if (self::$manifest) self::$errors[] = 'Configuration changed during collection';
    }
    private static function scope($scope, $code): array
    {
        $scope = ['store' => 'stores', 'website' => 'websites'][$scope] ?? $scope;
        if ($scope === 'default') return ['type' => $scope, 'code' => ''];
        if (is_object($code)) $code = $code->getCode();
        elseif ($code === null) $code = \Magento\Framework\App\ObjectManager::getInstance()->get(\Magento\Framework\App\Config\ScopeCodeResolver::class)->resolve($scope, $code);
        elseif (is_numeric($code)) $code = self::$manifest['scopes'][$scope][(string) $code] ?? null;
        if ($code === null || (!isset(self::$manifest['scopeCodes'][$scope][(string) $code])
            && !in_array($code, self::$manifest['scopes'][$scope] ?? [], true))) throw new \RuntimeException('Unknown XML request scope');
        return ['type' => $scope, 'code' => (string) $code];
    }
    private static function event(string $id, string $type, array $scope): void
    {
        $key = "$id\0$type\0" . $scope['type'] . '/' . $scope['code'];
        self::$events[$key] ??= ['id' => $id, 'type' => $type, 'requestedScope' => $scope, 'hits' => 0];
        self::$events[$key]['hits']++;
    }
    private static function observe(string $id, array $scope, string $prefix, string $leaf, $value): void
    {
        $expected = self::$manifest['valueHashes'][$prefix][$leaf] ?? null;
        if ($expected !== hash('sha256', json_encode($value, JSON_THROW_ON_ERROR))) {
            self::$errors[] = 'Cached configuration differs from current provenance; use --refresh-cache';
            return;
        }
        self::event($id, 'config-read', $scope);
    }
    public static function enterAccessor($path): void
    {
        $path = trim((string) $path, '/');
        self::$accessors[] = $path !== '' && isset(self::$manifest['paths'][$path]) ? $path : null;
    }
    public static function leaveAccessor(): void
    {
        array_pop(self::$accessors);
    }
    public static function accessorRead($result, $path): void
    {
        if (!self::$manifest || self::$busy || !self::$accessors) return;
        self::$readHook = true;
        $expected = self::$accessors[array_key_last(self::$accessors)];
        if ($expected === null) return;
        $path = trim((string) $path, '/');
        $parts = explode('/', $path, 3);
        if ($parts[0] === 'default') $leaf = substr($path, 8);
        elseif (in_array($parts[0], ['stores', 'websites'], true) && isset($parts[1])) $leaf = $parts[2] ?? '';
        else return;
        // Cache population and audit snapshots can fetch entire scopes while
        // an accessor is running. Only its requested subtree is consumption.
        if ($leaf === $expected) self::systemRead($result, $path);
    }
    private static function systemRead($result, $path): void
    {
        if (!self::$manifest || self::$busy) return;
        self::$readHook = true;
        $path = trim((string) $path, '/');
        $parts = explode('/', $path, 3);
        if ($parts[0] === 'default') self::read($result, substr($path, 8), 'default', '');
        elseif (in_array($parts[0], ['stores', 'websites'], true) && isset($parts[1])) {
            self::read($result, $parts[2] ?? '', $parts[0], $parts[1]);
        }
    }
    public static function read($result, $path, $scope, $code): void
    {
        if (!self::$manifest || self::$busy) return;
        self::$readHook = true;
        $path = trim((string) $path, '/');
        if (!isset(self::$manifest['paths'][$path])) return;
        self::$busy = true;
        try {
            $requested = self::scope($scope, $code);
            $prefix = $requested['type'] . ($requested['type'] === 'default' ? '' : '/' . $requested['code']);
            $origins = self::$manifest['originScopes'][$prefix] ?? [];
            if (is_array($result)) {
                foreach ($origins as $leaf => $id) {
                    if ($path !== '' && !str_starts_with($leaf, $path . '/')) continue;
                    $relative = $path === '' ? $leaf : substr($leaf, strlen($path) + 1);
                    $value = $result; $present = true;
                    foreach (explode('/', $relative) as $part) {
                        if (!is_array($value) || !array_key_exists($part, $value)) { $present = false; break; }
                        $value = $value[$part];
                    }
                    if ($present) self::observe($id, $requested, $prefix, $leaf, $value);
                }
            } elseif (isset($origins[$path])) self::observe($origins[$path], $requested, $prefix, $path, $result);
        } catch (\Throwable $error) { self::$errors[] = 'Cannot attribute configuration read'; }
        finally { self::$busy = false; }
    }
    public static function fieldData(array $data): void
    {
        if (!self::$manifest || self::$busy) return;
        try {
            $field = trim(($data['path'] ?? '') . '/' . ($data['id'] ?? ''), '/');
            if (!isset(self::$manifest['fields'][$field])) return;
            // This native callback observes Magento's cached source metadata before
            // interceptor plugins add presentation data such as ScopeHint's path_hint.
            // Reading it alone grants no coverage; the field must also render.
            self::$fieldSources[$field] = hash('sha256', Xml::canonical($data));
        } catch (\Throwable $error) { self::$errors[] = 'Cannot attribute Admin field source metadata'; }
    }
    public static function render($element): void
    {
        if (!self::$manifest || self::$busy) return;
        self::$renderHook = true; self::$busy = true;
        try {
            $config = $element->getFieldConfig();
            $field = trim(($config['path'] ?? '') . '/' . ($config['id'] ?? ''), '/');
            $id = self::$manifest['fields'][$field][0] ?? null;
            if ($id) {
                if (!isset(self::$fieldSources[$field])) {
                    self::$errors[] = 'Admin field source metadata was not observed before rendering';
                    return;
                }
                if (self::$manifest['fieldHashes'][$field] !== self::$fieldSources[$field]) {
                    self::$errors[] = 'Cached Admin structure differs from current XML provenance; use --refresh-cache';
                    return;
                }
                $scope = self::scope($element->getScope() ?: 'default', $element->getScopeId());
                self::event($id, 'system-field-render', $scope);
            }
        } catch (\Throwable $error) { self::$errors[] = 'Cannot attribute Admin field rendering'; }
        finally { self::$busy = false; }
    }
    public static function finish(): array
    {
        if (!self::$manifest) throw new \RuntimeException('XML collector did not initialize');
        if (self::$errors) throw new \RuntimeException(implode('; ', array_unique(self::$errors)));
        $data = ['run' => self::$manifest['run'], 'manifest' => self::$manifest['id'], 'readHook' => self::$readHook,
            'renderHook' => self::$renderHook, 'observerHook' => Observers::finish(), 'events' => array_values(self::$events)];
        [$data['pluginHook'], $data['ambiguousPlugins']] = class_exists(Plugins::class, false) ? Plugins::finish() : [false, []];
        return $data;
    }
}
