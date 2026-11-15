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
    private static bool $busy = false;
    private static bool $readHook = false;
    private static bool $renderHook = false;

    public static function start(string $run): void
    {
        self::$manifest = json_decode(file_get_contents('/coverage/xml-collector.json'), true, flags: JSON_THROW_ON_ERROR);
        if (self::$manifest['run'] !== $run) throw new \RuntimeException('Stale XML manifest');
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
        if ($code === null || !in_array($code, self::$manifest['scopes'][$scope] ?? [], true)) throw new \RuntimeException('Unknown XML request scope');
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
    public static function render($element): void
    {
        if (!self::$manifest || self::$busy) return;
        self::$renderHook = true; self::$busy = true;
        try {
            $config = $element->getFieldConfig();
            $field = trim(($config['path'] ?? '') . '/' . ($config['id'] ?? ''), '/');
            $id = self::$manifest['fields'][$field][0] ?? null;
            if ($id) {
                if (self::$manifest['fieldHashes'][$field] !== hash('sha256', Xml::canonical($config))) {
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
            'renderHook' => self::$renderHook, 'events' => array_values(self::$events)];
        return $data;
    }
}
