<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

final class Xml
{
    public static function document(string $source): \DOMDocument
    {
        if (preg_match('/<!DOCTYPE|<!ENTITY/i', $source)) throw new \RuntimeException('XML entities and DTDs are unsupported');
        $previous = libxml_use_internal_errors(true);
        try {
            $dom = new \DOMDocument();
            if (!$dom->loadXML($source, LIBXML_NONET)) throw new \RuntimeException('Malformed XML');
            return $dom;
        } finally { libxml_clear_errors(); libxml_use_internal_errors($previous); }
    }

    // DOM supplies semantic nodes; this lexical pass retains inclusive original
    // closing lines, including CDATA, comments and quoted > in attributes.
    public static function ranges(string $source, \DOMDocument $dom): array
    {
        preg_match_all('~<!--.*?-->|<!\[CDATA\[.*?\]\]>|<\?.*?\?>|</?[A-Za-z_](?:[^>"\']|"[^"]*"|\'[^\']*\')*>~s', $source, $matches, PREG_OFFSET_CAPTURE);
        $ranges = []; $stack = [];
        foreach ($matches[0] as [$token, $offset]) {
            if (str_starts_with($token, '<!') || str_starts_with($token, '<?')) continue;
            $start = substr_count(substr($source, 0, $offset), "\n") + 1;
            $end = $start + substr_count($token, "\n");
            if (str_starts_with($token, '</')) {
                $index = array_pop($stack);
                if ($index === null) throw new \RuntimeException('Invalid XML line map');
                $ranges[$index]['endLine'] = $end;
            } else {
                $index = count($ranges);
                $ranges[] = ['startLine' => $start, 'endLine' => $end];
                if (!preg_match('~/\s*>$~', $token)) $stack[] = $index;
            }
        }
        $nodes = (new \DOMXPath($dom))->query('//*');
        if ($stack || count($ranges) !== $nodes->length) throw new \RuntimeException('Incomplete XML line map');
        $result = [];
        foreach ($nodes as $index => $node) $result[$node->getNodePath()] = $ranges[$index];
        return $result;
    }

    public static function leaves(array $data, string $prefix = ''): array
    {
        $result = [];
        foreach ($data as $key => $value) {
            $key = $prefix === '' ? (string) $key : "$prefix/$key";
            if (is_array($value)) $result += self::leaves($value, $key);
            else $result[$key] = $value;
        }
        return $result;
    }

    public static function canonical(array $data): string
    {
        ksort($data);
        foreach ($data as &$value) if (is_array($value)) $value = json_decode(self::canonical($value), true, flags: JSON_THROW_ON_ERROR);
        return json_encode($data, JSON_THROW_ON_ERROR);
    }

    public static function mask(array $data): array
    {
        foreach ($data as &$value) $value = is_array($value) ? self::mask($value) : '__magelens_external__';
        return $data;
    }

    public static function symbolicSources(array $sources, array $known): array
    {
        $documents = []; $counts = []; $occurrences = []; $firstEmpty = []; $nullText = []; $unmeasured = [];
        $query = '/config/default//*[not(*)] | /config/websites/*//*[not(*)] | /config/stores/*//*[not(*)]';
        foreach ($sources as $file => $source) {
            $dom = self::document($source);
            $documents[$file] = $dom;
            foreach ((new \DOMXPath($dom))->query('//*') as $element) {
                $key = $element->getNodePath();
                $occurrences[$key] = ($occurrences[$key] ?? 0) + 1;
            }
            foreach ((new \DOMXPath($dom))->query($query) as $node) {
                $key = $node->getNodePath();
                if (!isset($counts[$key])) $firstEmpty[$key] = !$node->hasChildNodes();
                $counts[$key] = ($counts[$key] ?? 0) + 1;
                if ($node->childNodes->length === 1 && $node->firstChild instanceof \DOMText
                    && !$node->firstChild instanceof \DOMCdataSection && trim($node->firstChild->nodeValue) === '') $nullText[$key] = true;
                $scalar = !$node->hasChildNodes();
                foreach ($node->childNodes as $child) if ($child instanceof \DOMCdataSection
                    || $child instanceof \DOMText && (trim($child->nodeValue) !== '' || $node->childNodes->length === 1)) $scalar = true;
                if (!$scalar) $unmeasured[$key] = 'A node without a substitutable scalar value has unmeasured provenance';
                foreach ($node->childNodes as $child) if ($child instanceof \DOMCdataSection && $child->nodeValue === '') {
                    $unmeasured[$key] = 'Empty CDATA provenance cannot be represented without changing conversion semantics';
                }
            }
        }
        foreach ($counts as $key => $count) {
            if ($firstEmpty[$key] && $occurrences[$key] > 1
                || isset($nullText[$key]) && $occurrences[$key] > $count) {
                $unmeasured[$key] = 'An empty node has competing scalar or subtree declarations: exact provenance is unmeasured';
            }
        }
        foreach ($documents as $file => $dom) {
            foreach ((new \DOMXPath($dom))->query($query) as $node) {
                $key = $node->getNodePath();
                if (isset($unmeasured[$key])) continue;
                $id = $known[$file][$key] ?? hash('sha256', "$file\0$key");
                if (!$node->hasChildNodes()) {
                    // Only a unique empty declaration needs a token. Empty
                    // overrides must retain their zero-child merge behavior.
                    if ($occurrences[$key] === 1) $node->appendChild($dom->createTextNode($id));
                    continue;
                }
                foreach ($node->childNodes as $child) {
                    if ($child instanceof \DOMCdataSection
                        || $child instanceof \DOMText && (trim($child->nodeValue) !== '' || $node->childNodes->length === 1)) {
                        $child->nodeValue = $id;
                    }
                }
            }
            // Keep comments, CDATA, whitespace and child counts: Magento uses
            // that structure to choose its merge branch, not just node values.
            $sources[$file] = $dom->saveXML();
        }
        return ['sources' => $sources, 'unmeasured' => $unmeasured];
    }

    public static function declarations(string $path, string $source, string $family): array
    {
        $dom = self::document($source);
        $schema = $dom->documentElement->getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'noNamespaceSchemaLocation');
        $expected = match ($family) {
            'config' => 'urn:magento:module:Magento_Store:etc/config.xsd',
            'system' => 'urn:magento:module:Magento_Config:etc/system_file.xsd',
            'events' => 'urn:magento:framework:Event/etc/events.xsd',
            'plugins' => 'urn:magento:framework:ObjectManager/etc/config.xsd',
        };
        if ($dom->documentElement->tagName !== 'config' || $schema !== $expected) return [];
        $ranges = self::ranges($source, $dom);
        $xpath = new \DOMXPath($dom);
        if ($family === 'plugins') {
            $scope = preg_match('~/etc/([^/]+)/di\.xml$~', $path, $match) ? $match[1] : 'global';
            $result = []; $seen = [];
            foreach ($xpath->query('/config/type/plugin | /config/virtualType/plugin') as $node) {
                $target = ltrim($node->parentNode->getAttribute('name'), '\\');
                $name = $node->getAttribute('name');
                $key = "$target\0$name";
                $index = $seen[$key] ?? 0;
                $seen[$key] = $index + 1;
                $result[] = ['id' => hash('sha256', "$path\0plugins\0$key\0$index"),
                    'path' => "$target/$name", 'family' => $family,
                    'declaredScope' => ['type' => $scope, 'code' => ''], ...$ranges[$node->getNodePath()],
                    'node' => $node->getNodePath(), 'registration' => ['target' => $target, 'name' => $name],
                    'supported' => false, 'reason' => null];
            }
            return $result;
        }
        if ($family === 'events') {
            $scope = preg_match('~/etc/([^/]+)/events\.xml$~', $path, $match) ? $match[1] : 'global';
            $result = []; $seen = [];
            foreach ($xpath->query('/config/event/observer') as $node) {
                $rawEvent = $node->parentNode->getAttribute('name');
                $observer = $node->getAttribute('name');
                $key = "$rawEvent\0$observer";
                $index = $seen[$key] ?? 0;
                $seen[$key] = $index + 1;
                $id = hash('sha256', "$path\0events\0$key\0$index");
                $event = mb_strtolower($rawEvent);
                $result[] = ['id' => $id, 'path' => "$event/$observer", 'family' => $family,
                    'declaredScope' => ['type' => $scope, 'code' => ''], ...$ranges[$node->getNodePath()],
                    'node' => $node->getNodePath(), 'registration' => ['event' => $event, 'observer' => $observer],
                    'supported' => false, 'reason' => null];
            }
            return $result;
        }
        $query = $family === 'config' ? '/config/default//*[not(*)] | /config/websites/*//*[not(*)] | /config/stores/*//*[not(*)]' : '/config/system/section//field';
        $result = [];
        foreach ($xpath->query($query) as $node) {
            $parts = []; $parent = $node;
            while ($parent instanceof \DOMElement && $parent->tagName !== 'config') {
                array_unshift($parts, $family === 'system' ? $parent->getAttribute('id') : $parent->tagName);
                $parent = $parent->parentNode;
            }
            if ($family === 'config') {
                $scope = array_shift($parts);
                $code = $scope === 'default' ? '' : array_shift($parts);
            } else { array_shift($parts); $scope = 'default'; $code = ''; }
            $key = implode('/', $parts);
            $id = hash('sha256', "$path\0$family\0$scope\0$code\0$key");
            $result[] = ['id' => $id, 'path' => $key, 'family' => $family,
                'declaredScope' => ['type' => $scope, 'code' => $code], ...$ranges[$node->getNodePath()],
                'node' => $node->getNodePath(), 'supported' => true, 'reason' => null];
        }
        return $result;
    }
}
