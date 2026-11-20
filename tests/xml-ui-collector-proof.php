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
    public static array $events = [];

    public static function familyEvidence(
        string $id,
        string $type,
        string $area,
        string $outcome = 'observed',
        ?string $reason = null
    ): void {
        self::$events[] = [$id, $type, $area, $outcome, $reason];
    }
}

function startUiProof(string $app, string $tooling, string $run): array
{
    require_once $tooling . '/xml-data.php';
    require_once $tooling . '/xml-family-evidence.php';
    require_once $tooling . '/xml-family-ui.php';
    $files = [];
    foreach (glob($app . '/app/code/MageLens/UiProbe*/view/adminhtml/ui_component/*.xml') as $file) {
        $path = substr($file, strlen($app) + 1);
        $bytes = file_get_contents($file);
        $files[$path] = [
            'family' => 'ui-component',
            'path' => $path,
            'sourceHash' => hash('sha256', $bytes),
            'declarations' => UiFamily::declarations($path, $bytes),
        ];
    }
    if (count($files) !== 4) {
        throw new \RuntimeException('Missing disposable UI component fixture');
    }
    [$targets] = UiFamily::prepare(null, $files);
    foreach (UiFamily::hooks($targets + ['run' => $run]) as [$class, $method, $pre, $post]) {
        if (!\OpenTelemetry\Instrumentation\hook($class, $method, $pre, $post)) {
            throw new \RuntimeException('Could not install native UI hook');
        }
    }
    return $files;
}

function verifyUiEvidence(array $files, array $events, bool $cacheOnly): void
{
    $listing = 'magelens_ui_probe_listing.magelens_ui_probe_listing.probe_columns.';
    $form = 'magelens_ui_probe_form.magelens_ui_probe_form.probe_fields.';
    $byId = [];
    foreach ($files as $file) {
        foreach ($file['declarations'] as $item) {
            $byId[$item['id']] = $item + ['file' => $file['path']];
        }
    }
    $actual = [];
    foreach ($events as [$id, $type, $area, $outcome, $reason]) {
        $item = $byId[$id] ?? throw new \RuntimeException('Evidence refers to an unknown original declaration');
        if ($area !== 'adminhtml' || str_contains($item['path'], 'unopened')) {
            throw new \RuntimeException('Evidence from an unopened screen or wrong area');
        }
        if (($outcome !== 'observed') !== (is_string($reason) && $reason !== '')) {
            throw new \RuntimeException('Non-creditable evidence must explain the limitation');
        }
        $module = str_contains($item['file'], '/UiProbeOverlay/') ? 'overlay' : 'base';
        $key = implode('|', [$module, $item['path'], $type, $outcome]);
        $actual[$key] = $item['startLine'];
        $lines = file(BP . '/' . $item['file']);
        if (!preg_match('/<\w+\b/', $lines[$item['startLine'] - 1])) {
            throw new \RuntimeException('Evidence does not point at an original declaration');
        }
    }
    $cases = [
        ['base', $listing . 'untouched', 'ui-created', 'observed', 39],
        ['base', $listing . 'untouched#label', 'ui-prepared', 'observed', 41],
        ['base', $listing . 'untouched', 'ui-delivered', 'observed', 39],
        ['base', $listing . 'equal#label', 'ui-prepared', 'displaced', 46],
        ['overlay', $listing . 'equal#label', 'ui-prepared', 'observed', 12],
        ['base', $listing . 'replaced#label', 'ui-prepared', 'displaced', 51],
        ['base', $listing . 'disabled', 'ui-created', 'disabled', 54],
        ['base', $form . 'untouched', 'ui-prepared', 'observed', 35],
        ['base', $form . 'uninstantiated', 'ui-delivered', 'observed', 70],
        ['base', 'magelens_ui_probe_listing.probe_data_source#provider', 'ui-provider-executed', 'observed', 28],
        ['base', 'magelens_ui_probe_form.probe_form_data_source#provider', 'ui-provider-executed', 'observed', 24],
    ];
    foreach ($cases as [$module, $identity, $type, $outcome, $line]) {
        if ($cacheOnly && $type === 'ui-delivered') continue;
        if ($cacheOnly && $type === "ui-prepared" && !str_ends_with($identity, "#label")) $type = "ui-created";
        $key = implode('|', [$module, $identity, $type, $cacheOnly ? 'cache-only' : $outcome]);
        if (($actual[$key] ?? null) !== $line) {
            throw new \RuntimeException('Unproven UI XML evidence ' . $key . ' at expected line ' . $line
                . ', evidence: ' . json_encode($actual, JSON_THROW_ON_ERROR));
        }
    }
    foreach ($actual as $key => $line) {
        if (str_ends_with($key, '|observed') && ($cacheOnly || preg_match('/(?:equal#label|replaced#label|\.disabled)\|/', $key)
                && !str_starts_with($key, 'overlay|'))) {
            throw new \RuntimeException('False credit for source line ' . $line . ' ' . $key);
        }
    }
}
