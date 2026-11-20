<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

namespace MageLens\XmlCoverage;

use Magento\Framework\App\Cache\Type\Config;
use Magento\Framework\App\State;
use Magento\Framework\Cache\Frontend\Decorator\Bare;
use Magento\Framework\Cache\Frontend\Decorator\TagScope;
use Magento\Framework\Config\Dom as FrameworkDom;
use Magento\Ui\Config\Converter;
use Magento\Ui\Config\Data;
use Magento\Ui\Config\Reader;
use Magento\Ui\Config\Reader\Dom;
use Magento\Ui\Config\Reader\FileResolver;

final class UiOrigin
{
    private const CACHE_PARENT = '/coverage/raw/xml-ui';
    private const CACHE_ID = 'ui_component_configuration_data_';
    private array $reads = [];
    private array $proofs = [];
    private array $defaults = [];
    private array $cacheReads = [];
    private ?\WeakReference $state = null;
    private \WeakMap $documents;

    public function __construct(private array $instances, private ?string $run)
    {
        if ($run !== null && !preg_match('~^[a-f0-9]{32}$~D', $run)) {
            throw new \RuntimeException('Invalid UI coverage run');
        }
        $this->documents = new \WeakMap();
    }

    public function hooks(): array
    {
        return [
            [State::class, 'setAreaCode', null,
                function ($subject, array $params, $result, ?\Throwable $error, string $class): void {
                    if (!$error && $class === State::class) $this->state = \WeakReference::create($subject);
                }],
            [State::class, 'emulateAreaCode', function ($subject, array $params, string $class): void {
                if ($class === State::class) $this->state = \WeakReference::create($subject);
            }, null],
            [FileResolver::class, 'get', null, $this->defaults(...)],
            [Data::class, 'initData', $this->beginCache(...), $this->endCache(...)],
            [Reader::class, 'read', $this->beginRead(...), $this->endRead(...)],
            [Reader::class, 'readFiles', $this->readFiles(...), null],
            [Dom::class, '__construct', null, $this->document(...)],
            [Converter::class, 'convert', null, $this->converted(...)],
            [Bare::class, 'load', null, $this->cacheLoad(...)],
            [TagScope::class, 'save', null, $this->cacheSave(...)],
        ];
    }

    public function admin(): bool
    {
        $state = $this->state?->get();
        return $state !== null && (new \ReflectionProperty(State::class, '_areaCode'))->getValue($state) === 'adminhtml';
    }

    private function defaults($subject, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($error || $class !== FileResolver::class || !is_array($result)) return;
        if (!in_array($params[0] ?? null, ['etc/definition.xml', 'etc/definition.map.xml'], true)) return;
        $this->defaults[$params[0]] = array_map(static fn(string $xml): string => hash('sha256', $xml), $result);
    }

    private function beginCache($subject, array $params): void
    {
        $this->cacheReads[] = (new \ReflectionProperty(Data::class, 'cacheId'))->getValue($subject);
    }

    private function endCache($subject, array $params): void
    {
        array_pop($this->cacheReads);
    }

    public function items(string $namespace): array
    {
        $items = [];
        foreach ($this->instances[$namespace] ?? [] as $file) {
            foreach ($file['items'] as $item) $items[$item['id']] = $item;
        }
        return $items;
    }

    public function proof(string $namespace): ?array
    {
        return $this->proofs[$namespace] ?? null;
    }

    private function beginRead($subject, array $params, string $class): void
    {
        if ($class !== Reader::class) return;
        $filename = (new \ReflectionProperty(Reader::class, 'fileName'))->getValue($subject);
        $name = basename($filename, '.xml');
        $cacheId = $this->cacheReads[array_key_last($this->cacheReads)] ?? null;
        $active = $filename === "$name.xml" && $cacheId === self::CACHE_ID . $name
            && isset($this->instances[$name]) && $this->admin();
        $this->reads[] = [
            'subject' => $subject, 'name' => $active ? $name : null, 'sources' => [],
            'order' => [], 'pending' => [], 'offset' => 0, 'origins' => [], 'safe' => true,
        ];
    }

    private function readFiles($subject, array $params): void
    {
        $key = array_key_last($this->reads);
        if ($key === null || $this->reads[$key]['name'] === null || $this->reads[$key]['subject'] !== $subject) return;
        $read = &$this->reads[$key];
        foreach ($params[0] ?? [] as $file => $bytes) {
            $read['order'][] = $file;
            $read['sources'][$file] = hash('sha256', $bytes);
        }
    }

    private function document($subject, array $params, $result, ?\Throwable $error, string $class): void
    {
        $key = array_key_last($this->reads);
        if ($class !== Dom::class || $key === null || $error || $this->reads[$key]['name'] === null) return;
        $read = &$this->reads[$key];
        $file = $read['order'][$read['offset']++] ?? null;
        if (!$file || $read['sources'][$file] !== hash('sha256', $params[0])) {
            $read['safe'] = false;
            return;
        }
        $dom = (new \ReflectionProperty(FrameworkDom::class, 'dom'))->getValue($subject);
        $this->documents[$dom] = [$file, $key];
        $read['pending'][$file] = true;
    }

    private function converted($subject, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Converter::class || $error || !is_array($result) || !is_object($params[0] ?? null)) return;
        $source = $this->documents[$params[0]] ?? null;
        if ($source === null) return;
        [$file, $key] = $source;
        if (!isset($this->reads[$key]['pending'][$file])) return;
        $read = &$this->reads[$key];
        unset($read['pending'][$file], $this->documents[$params[0]]);
        $relative = str_starts_with($file, BP . '/') ? substr($file, strlen(BP) + 1) : null;
        $known = $this->instances[$read['name']][$relative] ?? null;
        if ($known && $known['hash'] !== $read['sources'][$file]) {
            $read['safe'] = false;
            return;
        }
        if (isset($result['attributes']['extends'])) {
            $read['safe'] = false;
            return;
        }
        $declarations = [];
        foreach ($known['items'] ?? [] as $item) {
            $declarations[$item['identity']] = array_key_exists($item['identity'], $declarations) ? null : $item;
        }
        foreach ($this->items($read['name']) as $item) {
            $component = $result;
            foreach ($item['segments'] as $segment) $component = $component['children'][$segment] ?? null;
            if (!is_array($component)) continue;
            $argument = match ($item['kind']) {
                'label' => $component['arguments']['data']['item']['config']['item']['label'] ?? null,
                'provider' => $component['arguments']['dataProvider']['argument']['class'] ?? null,
                default => $component['uiComponentType'] ?? null,
            };
            if ($argument === null) continue;
            $candidate = $declarations[$item['identity']] ?? null;
            $read['origins'][$item['identity']] = $candidate && ($component['uiComponentType'] ?? null) === $candidate['type']
                ? $candidate['id'] : null;
        }
    }

    private function endRead($subject, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Reader::class) return;
        $read = array_pop($this->reads);
        $name = $read['name'];
        if ($name === null) return;
        $valid = !$error && $read['safe'] && $read['order'] && !$read['pending'] && count($read['order']) === $read['offset'];
        $this->proofs[$name] = $valid
            ? ['origins' => $read['origins'], 'sources' => $read['sources'] + ($this->defaults['etc/definition.xml'] ?? [])
                + ($this->defaults['etc/definition.map.xml'] ?? [])]
            : ['failure' => 'The native UI reader did not provide a complete original-source trace'];
    }

    private function cacheLoad($subject, array $params, $result, ?\Throwable $error, string $class): void
    {
        $name = $this->cacheName($subject, $params[0] ?? null);
        if ($name === null) return;
        unset($this->proofs[$name]);
        if ($error || !is_string($result)) return;
        $file = $this->proofFile($name, $result);
        if ($file === null || !is_file($file)) return;
        $proof = json_decode((string) file_get_contents($file), true, flags: JSON_THROW_ON_ERROR);
        if (isset($proof['failure'])) {
            $this->proofs[$name] = $proof;
            return;
        }
        foreach ($proof['sources'] as $source => $hash) {
            if (!is_file($source) || hash_file('sha256', $source) !== $hash) return;
        }
        $this->proofs[$name] = $proof;
    }

    private function cacheSave($subject, array $params, $result, ?\Throwable $error, string $class): void
    {
        $name = $this->cacheName($subject, $params[1] ?? null);
        if ($name === null || $error || $result !== true || !is_string($params[0] ?? null)) return;
        $proof = $this->proofs[$name] ?? ['failure' => 'The native UI cache saved a payload without an original-source trace'];
        $file = $this->proofFile($name, $params[0]);
        if ($file === null) return;
        $directory = dirname($file);
        if (!is_dir($directory) && !@mkdir($directory, 0770, true) && !is_dir($directory)) return;

        $lock = fopen($file . '.lock', 'c');
        if ($lock === false) return;
        try {
            if (!flock($lock, LOCK_EX)) return;
            if (is_file($file)) {
                $previous = json_decode((string) file_get_contents($file), true, flags: JSON_THROW_ON_ERROR);
                if ($previous === $proof || isset($previous['failure'])) return;
                $proof = ['failure' => 'The same native cache payload was produced by different UI source traces'];
                $this->proofs[$name] = $proof;
            }
            $temporary = tempnam($directory, 'ui-');
            if ($temporary === false) return;
            try {
                if (file_put_contents($temporary, json_encode($proof, JSON_THROW_ON_ERROR)) !== false) rename($temporary, $file);
            } finally {
                if (is_file($temporary)) unlink($temporary);
            }
        } finally {
            fclose($lock);
        }
    }

    private function cacheName($subject, $identifier): ?string
    {
        if (!$subject instanceof Config || !is_string($identifier) || !str_starts_with($identifier, self::CACHE_ID)) return null;
        if (($this->cacheReads[array_key_last($this->cacheReads)] ?? null) !== $identifier) return null;
        $name = substr($identifier, strlen(self::CACHE_ID));
        return isset($this->instances[$name]) && $this->admin() ? $name : null;
    }

    private function proofFile(string $name, string $bytes): ?string
    {
        return $this->run === null ? null
            : self::CACHE_PARENT . '/' . $this->run . '/' . hash('sha256', "$name\0$bytes") . '.json';
    }
}
