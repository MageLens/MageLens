<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

final class FamilyEvidence
{
    private const COLLECTORS = [
        'ui' => [UiFamily::class, ['ui-component']],
        'routing' => [RoutingFamily::class, ['routes', 'webapi']],
        'admin-navigation' => [AdminNavigationFamily::class, ['acl', 'menu']],
        'cron' => [CronFamily::class, ['cron']],
    ];

    public const LIMITATIONS = ['ambiguous', 'displaced', 'cache-only', 'disabled'];
    public const OBSERVATIONS = ['observed', 'allowed', 'denied', 'matched', 'entered', 'completed', 'failed'];

    private static function collectors(): array
    {
        return array_filter(self::COLLECTORS, static function (array $collector, string $name): bool {
            $file = __DIR__ . '/xml-family-' . $name . '.php';
            if (!is_file($file)) return false;
            require_once $file;
            if (!class_exists($collector[0], false)) throw new \RuntimeException('Missing XML family collector');
            return true;
        }, ARRAY_FILTER_USE_BOTH);
    }

    public static function declaration(
        string $path,
        string $family,
        \DOMElement $node,
        array $ranges,
        string $identity,
        array $effects
    ): array {
        $nodePath = $node->getNodePath();
        $range = $ranges[$nodePath] ?? throw new \RuntimeException('Missing original XML declaration span');
        $scope = preg_match('~/etc/([^/]+)/[^/]+\.xml$~', $path, $match) ? $match[1] : 'global';
        if (str_contains($path, '/view/adminhtml/')) $scope = 'adminhtml';
        if (str_contains($path, '/view/frontend/')) $scope = 'frontend';
        return [
            'id' => hash('sha256', implode("\0", [$path, $family, $nodePath, $identity])),
            'family' => $family,
            'path' => $identity,
            'node' => $nodePath,
            'declaredScope' => ['type' => $scope, 'code' => ''],
            'supported' => true,
            'effective' => true,
            'reason' => null,
            'effects' => $effects,
            ...$range,
        ];
    }

    public static function inventory(string $path, string $bytes, array $themeAreas = []): ?array
    {
        foreach (self::collectors() as [$collector, $families]) {
            $items = $collector === UiFamily::class
                ? $collector::declarations($path, $bytes, $themeAreas)
                : $collector::declarations($path, $bytes);
            if ($items === null) continue;
            $family = $items[0]['family'] ?? $families[0];
            if (!in_array($family, $families, true)) throw new \RuntimeException('Invalid XML declaration family');
            return ['family' => $family, 'declarations' => $items];
        }
        return null;
    }

    public static function prepare($om, array &$files): array
    {
        $targets = [];
        $providers = [];
        foreach (self::collectors() as $name => [$collector, $families]) {
            if (!array_filter($files, static fn(array $file): bool => in_array($file['family'], $families, true) && $file['declarations'])) continue;
            [$targets[$name], $hashes] = $collector::prepare($om, $files);
            foreach ($hashes as $file => $hash) {
                if (isset($providers[$file]) && $providers[$file] !== $hash) {
                    throw new \RuntimeException('XML family collectors disagree on source fingerprint');
                }
                $providers[$file] = $hash;
            }
        }
        $contracts = [];
        foreach ($files as $file) foreach ($file['declarations'] as $item) {
            if ($item['supported'] && isset($item['effects'])) $contracts[$item['id']] = $item['effects'];
        }
        return [$targets, $providers, $contracts];
    }

    public static function hooks(array $targets, string $run): array
    {
        $hooks = [];
        foreach (self::collectors() as $name => [$collector]) {
            if (!array_key_exists($name, $targets)) continue;
            foreach ($collector::hooks($targets[$name] + ['run' => $run]) as [$class, $method, $pre, $post]) {
                $hooks[] = [$class, $method, self::observe($pre), self::observe($post)];
            }
        }
        return $hooks;
    }

    private static function observe(?\Closure $callback): ?\Closure
    {
        if ($callback === null) return null;
        return static function (...$arguments) use ($callback): void {
            try {
                $callback(...$arguments);
            } catch (\Throwable) {
                Recorder::familyFailure();
            }
        };
    }
}
