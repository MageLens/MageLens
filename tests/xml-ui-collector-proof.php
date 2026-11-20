<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\Component\ComponentRegistrar;
use Magento\Ui\Config\Reader;

function uiProofEvents(bool $clear = false): array
{
    $events = new \ReflectionProperty(Recorder::class, 'events');
    $result = array_values($events->getValue());
    if ($clear) $events->setValue(null, []);
    return $result;
}

function startUiProof(string $app, string $tooling, string $run): array
{
    require_once $tooling . '/xml-data.php';
    require_once $tooling . '/xml-family-evidence.php';
    require_once $tooling . '/xml-recorder.php';
    $areas = Xml::registeredThemeAreas((new ComponentRegistrar())->getPaths(ComponentRegistrar::THEME), BP);
    $paths = glob($app . '/app/code/MageLens/UiProbe*/view/adminhtml/ui_component/*.xml');
    foreach (\UI_PROOF_THEMES as $root) {
        $paths[] = $app . '/' . $root . '/MageLens_UiProbe/ui_component/magelens_ui_probe_listing.xml';
    }
    $files = [];
    foreach ($paths as $file) {
        $path = substr($file, strlen($app) + 1);
        $bytes = file_get_contents($file);
        $inventory = FamilyEvidence::inventory($path, $bytes, $areas);
        if (($inventory['family'] ?? null) !== 'ui-component') throw new \RuntimeException('Missing disposable UI component fixture');
        $files[$path] = ['path' => $path, 'sourceHash' => hash('sha256', $bytes), ...$inventory];
    }
    [$targets, , $contracts] = FamilyEvidence::prepare(null, $files);
    (new \ReflectionProperty(Recorder::class, 'manifest'))->setValue(null, ['familyContracts' => $contracts]);
    foreach (FamilyEvidence::hooks($targets, $run) as [$class, $method, $pre, $post]) {
        if (!LayoutRuntimeHooks::registerWrapped($class, $method, $pre, $post)) {
            throw new \RuntimeException('Could not install native UI hook');
        }
    }
    if (!\OpenTelemetry\Instrumentation\hook(Reader::class, 'read', null, UiProofReads::finished(...))) {
        throw new \RuntimeException('Could not monitor native UI cache misses');
    }
    return $files;
}

final class UiProofReads
{
    public static array $names = [];

    public static function finished($subject, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Reader::class) return;
        $name = (new \ReflectionProperty(Reader::class, 'fileName'))->getValue($subject);
        if (str_starts_with($name, 'magelens_ui_probe_')) self::$names[] = $name;
    }
}

function verifyUiEvidence(array $files, string $mode, string $run, bool $repeat): void
{
    LayoutRuntimeHooks::assertHealthy();
    \verify(!(new \ReflectionProperty(Recorder::class, 'errors'))->getValue(), 'Native UI collector reported an error');
    $cold = $mode === '--collect' && !$repeat;
    \verify(UiProofReads::$names === ($cold ? array_map(static fn(string $name): string => 'magelens_ui_probe_' . $name . '.xml',
        ['listing', 'form', 'provider_throws', 'provider_catches']) : []), 'Unexpected native configuration reads: ' . json_encode(UiProofReads::$names));
    UiProofReads::$names = [];

    $byId = [];
    foreach ($files as $path => $file) {
        $source = match (true) {
            str_starts_with($path, 'vendor/') => 'composer',
            str_starts_with($path, 'app/design/') => 'local',
            str_contains($path, '/UiProbeOverlay/') => 'overlay',
            default => 'base',
        };
        foreach ($file['declarations'] as $item) {
            $byId[$item['id']] = ['source' => $source, ...$item];
        }
    }
    $cacheOnly = $mode === '--expect-cache-only';
    $listing = 'magelens_ui_probe_listing.magelens_ui_probe_listing.probe_columns.';
    $form = 'magelens_ui_probe_form.magelens_ui_probe_form.probe_fields.';
    $prepared = 'ui-prepared';
    $delivered = 'ui-delivered';
    $provider = 'ui-provider-executed';
    $cases = [
        ['base', $listing . 'untouched', 39, ['ui-created' => 'observed']],
        ['base', $listing . 'untouched#label', 41, [$prepared => 'observed', $delivered => 'observed']],
        ['base', $listing . 'equal#label', 46, [$prepared => 'displaced', $delivered => null]],
        ['overlay', $listing . 'equal#label', 12, [$prepared => 'observed', $delivered => 'observed']],
        ['base', $listing . 'replaced#label', 51, [$prepared => 'displaced', $delivered => null]],
        ['base', $listing . 'disabled', 54, ['ui-created' => 'disabled']],
        ['base', $listing . 'before_different#label', 64, [$prepared => 'displaced', $delivered => 'displaced']],
        ['base', $listing . 'before_equal#label', 69, [$prepared => 'displaced', $delivered => 'displaced']],
        ['base', $listing . 'after_prepare#label', 74, [$prepared => 'observed', $delivered => 'displaced']],
        ['base', $listing . 'theme_label#label', 79, [$prepared => 'displaced', $delivered => null]],
        ['local', $listing . 'theme_label#label', 12, [$prepared => 'displaced', $delivered => null]],
        ['composer', $listing . 'theme_label#label', 12, [$prepared => 'observed', $delivered => 'observed']],
        ['base', $form . 'untouched#label', 38, [$prepared => 'observed', $delivered => 'observed']],
        ['base', $form . 'uninstantiated', 70, [$delivered => 'observed']],
        ['base', 'magelens_ui_probe_listing.probe_data_source#provider', 28, [$provider => 'observed']],
        ['base', 'magelens_ui_probe_form.probe_form_data_source#provider', 24, [$provider => 'observed']],
        ['base', 'magelens_ui_probe_provider_throws.probe_provider_throws#provider', 10, [$provider => 'failed']],
        ['base', 'magelens_ui_probe_provider_catches.probe_provider_catches#provider', 10, [$provider => 'observed']],
    ];
    $events = uiProofEvents();
    $outcomes = [];
    foreach ($events as $event) {
        $item = $byId[$event['id']] ?? throw new \RuntimeException('Evidence refers to an unknown original declaration');
        \verify($event['area'] === 'adminhtml' && !str_contains($item['path'], 'unopened'), 'Evidence from an unopened screen or wrong area');
        \verify(!$cacheOnly || $event['outcome'] === 'cache-only', 'Cache-only proof received native credit');
        $outcomes[$event['id']][$event['type']][] = $event['outcome'];
    }
    $expected = [];
    $failures = [];
    foreach ($cases as [$source, $identity, $line, $effects]) {
        $ids = array_keys(array_filter($byId, static fn(array $item): bool => $item['source'] === $source && $item['path'] === $identity));
        \verify(count($ids) === 1 && $byId[$ids[0]]['startLine'] === $line, 'Wrong original declaration or line for ' . $source . ' ' . $identity);
        foreach ($effects as $effect => $outcome) {
            if ($cacheOnly) $outcome = $effect === $delivered ? null : 'cache-only';
            $actual = $outcomes[$ids[0]][$effect] ?? [];
            if ($actual !== ($outcome === null ? [] : [$outcome])) {
                $failures[] = $source . ' ' . $identity . ' on line ' . $line . ' ' . $effect
                    . ' expected ' . json_encode($outcome) . ', observed ' . json_encode($actual);
            }
            $expected[$ids[0]][$effect] = $outcome === 'observed' ? 'covered' : 'uncovered';
        }
    }
    \verify(!$failures, "Wrong native UI outcomes:\n" . implode("\n", $failures));
    if (!$repeat) {
        $directory = '/coverage/raw/xml-ui/' . $run;
        if (!is_dir($directory)) mkdir($directory, 0770, true);
        file_put_contents($directory . '/' . ltrim($mode, '-') . '-report.json', json_encode([
            'files' => array_values($files),
            'sources' => array_map(static fn(array $file): string => file_get_contents(BP . '/' . $file['path']), $files),
            'events' => $events,
            'expected' => $expected,
        ], JSON_THROW_ON_ERROR));
    }
}
