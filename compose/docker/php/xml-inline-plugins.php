<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Creatuity\Interception\Generator\{AreasPluginList, CompiledInterceptor};
use Magento\Framework\App\Filesystem\DirectoryList;
use Magento\Framework\Code\Generator\Io;
use Magento\Framework\Interception\Code\Generator\Interceptor as NativeInterceptor;
use Magento\Framework\Interception\ObjectManager\ConfigInterface;

final class InlinePluginManifest
{
    public static function generator(ConfigInterface $di): string
    {
        return $di->getOriginalInstanceType($di->getPreference(NativeInterceptor::class));
    }

    public static function supported(string $generator): bool
    {
        return in_array($generator, [NativeInterceptor::class, CompiledInterceptor::class], true);
    }

    public static function scopeOrder(string $generator, array $scopes): array
    {
        if ($generator === CompiledInterceptor::class) {
            // AreasPluginList first loads its default primary list. Its
            // CompiledPluginList starts with global and appends primary.
            [$scopes[0], $scopes[1]] = [$scopes[1], $scopes[0]];
        }
        return $scopes;
    }

    public static function prepare($om, array &$runtime): void
    {
        $subjects = [];
        foreach ($runtime as $entries) $subjects += $entries;
        if (!$subjects || self::generator($om->get(ConfigInterface::class)) !== CompiledInterceptor::class) return;
        $areas = $om->create(AreasPluginList::class);
        $lists = $areas->getPluginsConfigForAllAreas();
        $generate = new \ReflectionMethod(CompiledInterceptor::class, '_generateCode');
        $directory = $om->get(DirectoryList::class)->getPath(DirectoryList::GENERATED_CODE);
        $io = $om->create(Io::class, ['generationDirectory' => $directory]);
        foreach ($subjects as $subject => $entry) {
            $wrapper = $subject . '\\Interceptor';
            // The installed generator produces the expected text in memory.
            // Compare all executable code, including ordering and empty cases.
            $source = "<?php\n" . $generate->invoke(new CompiledInterceptor($areas, $subject, $wrapper, $io));
            $hash = self::hash($source);
            $filename = $io->generateResultFileName($wrapper);
            if (is_file($filename) && self::hash(file_get_contents($filename)) !== $hash) {
                throw new \RuntimeException('Generated plugin interceptor differs from XML provenance; regenerate Magento interceptors');
            }
            $sites = self::sites($source);
            foreach (PluginManifest::AREAS as $area) {
                if (!isset($runtime[$area][$subject])) continue;
                $list = $lists[$area] ?? throw new \RuntimeException('Missing generated plugin configuration scope');
                PluginManifest::validateList($list, [$subject => $runtime[$area][$subject]], array_map(
                    static fn(string $name) => PluginManifest::property($list, $name),
                    ['_data', '_inherited', '_processed']
                ));
                $runtime[$area][$subject]['inline'] = ['hash' => $hash, 'sites' => $sites];
            }
        }
    }

    public static function hash(string $source): string
    {
        return hash('sha256', str_replace("\r\n", "\n", $source));
    }

    public static function sites(string $source): array
    {
        preg_match_all('~\* plugin "([^\r\n]+)"\n\s*\* @return [^\n]+\n\s*\*/\n\s*private function (____plugin_\w+)\(~', $source, $matches, PREG_SET_ORDER);
        $getters = array_column($matches, 1, 2);
        $method = null;
        $sites = [];
        foreach (explode("\n", $source) as $index => $line) {
            if (preg_match('~^\s*public function &?\s*(\w+)\(~', $line, $match)) $method = $match[1];
            if (!preg_match('~\$this->(____plugin_\w+)\(\)->(before|around|after)(\w+)\(~', $line, $match)) continue;
            [, $getter, $phase, $name] = $match;
            if (!isset($getters[$getter]) || $method === null || strcasecmp($name, $method) !== 0) {
                throw new \RuntimeException('Unsupported generated plugin call site');
            }
            $sites[$index + 1] = ['method' => $method, 'name' => $getters[$getter], 'phase' => $phase, 'getter' => $getter];
        }
        return $sites;
    }
}
