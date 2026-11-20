<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

namespace MageLens\XmlCoverage;

use Laminas\Http\PhpEnvironment\Response as NativeResponse;
use Laminas\Stdlib\Message;
use Magento\Framework\HTTP\PhpEnvironment\Response;
use Magento\Framework\DataObject;
use Magento\Framework\View\Element\UiComponent\Context;
use Magento\Framework\View\Element\UiComponent\DataProvider\DataProviderInterface;
use Magento\Framework\View\Element\UiComponentFactory;
use Magento\Ui\Component\AbstractComponent;
use Magento\Ui\Component\DataSource;
use Magento\Ui\Component\Form;
use Magento\Ui\Component\Form\Field;
use Magento\Ui\Component\Listing;
use Magento\Ui\Component\Listing\Columns\Column;
use Magento\Ui\TemplateEngine\Xhtml\Result;

require_once __DIR__ . '/xml-layout-runtime-hooks.php';

final class UiRuntime
{
    private const CONFIG_SCRIPT = '~<script type="text/x-magento-init">(?:<!\[CDATA\[)?\s*(\{"\*":\s*\{"Magento_Ui/js/core/app":.*?\}\})\s*(?:\]\]>)?</script>~s';
    private array $factoryCalls = [];
    private array $providerReads = [];
    private \WeakMap $components;
    private \WeakMap $labels;
    private \WeakMap $roots;
    private int $fieldPreparations = 0;
    private array $scripts = [];
    private ?\WeakReference $sending = null;

    public function __construct(private readonly UiOrigin $origin)
    {
        $this->components = new \WeakMap();
        $this->labels = new \WeakMap();
        $this->roots = new \WeakMap();
    }

    public function hooks(): array
    {
        $hooks = [
            [UiComponentFactory::class, 'create', $this->beginFactory(...), $this->endFactory(...)],
            [UiComponentFactory::class, 'mergeMetadataItem', $this->metadata(...), null],
            [UiComponentFactory::class, 'createChildComponent', $this->child(...), null],
            [Listing::class, 'getDataSourceData', $this->beginProviderRead(...), $this->endProviderRead(...)],
            [Form::class, 'getDataSourceData', $this->beginProviderRead(...), $this->endProviderRead(...)],
            [DataProviderInterface::class, 'getData', $this->beginProviderData(...), $this->providerData(...)],
            [DataObject::class, 'setData', null, $this->labelWrite(...)],
            [DataObject::class, 'unsetData', null, $this->labelWrite(...)],
            [DataObject::class, 'offsetSet', null, $this->labelWrite(...)],
            [DataObject::class, 'offsetUnset', null, $this->labelWrite(...)],
            [Result::class, '__toString', null, $this->serialized(...)],
            [NativeResponse::class, 'sendContent', $this->sending(...), $this->sent(...)],
            [AbstractComponent::class, 'prepare', null, $this->prepared(...)],
        ];
        foreach (UiFamily::COMPONENT_CLASSES as $type => $class) {
            if ($type !== 'button') $hooks[] = [$class, 'prepare',
                $type === 'field' ? $this->beginFieldPreparation(...) : null, $this->prepared(...)];
        }
        return $hooks;
    }

    private function beginFactory($subject, array $params, string $class): void
    {
        if ($class !== UiComponentFactory::class) return;
        $name = $params[0] ?? null;
        $items = is_string($name) && ($params[1] ?? null) === null && $this->origin->admin() ? $this->origin->items($name) : [];
        $this->factoryCalls[] = [
            'subject' => $subject, 'namespace' => $name, 'items' => $items, 'metadata' => [],
            'reverse' => false, 'children' => [],
        ];
    }

    private function metadata($subject, array $params): void
    {
        $index = array_key_last($this->factoryCalls);
        if ($index === null) return;
        $call = &$this->factoryCalls[$index];
        if ($call['subject'] !== $subject || !$call['items']) return;
        $metadata = $params[1][$call['namespace']]['children'] ?? null;
        if (!is_array($metadata)) return;
        $call['reverse'] = $params[2] ?? false;
        $call['metadata'] = self::metadataEffects($metadata);
    }

    private static function metadataEffects(array $data): array
    {
        $result = [];
        foreach ($data as $name => $item) {
            $effects = [];
            if (array_key_exists('label', $item['arguments']['data']['config'] ?? [])) $effects[] = 'label';
            if (array_key_exists('dataProvider', $item['arguments'] ?? [])) $effects[] = 'provider';
            if (array_key_exists('class', $item['attributes'] ?? [])) $effects[] = 'component';
            if ($effects) $result[$name] = $effects;
            foreach (self::metadataEffects($item['children'] ?? []) as $child => $childEffects) {
                $result[$child] = array_values(array_unique([...($result[$child] ?? []), ...$childEffects]));
            }
        }
        return $result;
    }

    private function child($subject, array $params): void
    {
        $index = array_key_last($this->factoryCalls);
        if ($index === null || $this->factoryCalls[$index]['subject'] !== $subject) return;
        if (!$this->factoryCalls[$index]['items'] || !is_string($params[2] ?? null)) return;
        $this->factoryCalls[$index]['children'][$params[2]][] =
            (bool) (int) ($params[0]['arguments']['data']['disabled'] ?? 0);
    }

    private function endFactory($subject, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== UiComponentFactory::class) return;
        $call = array_pop($this->factoryCalls);
        if ($error || !$call['items'] || !$result instanceof AbstractComponent) return;
        if (!self::native($result, Listing::class) && !self::native($result, Form::class)) return;
        $proof = $this->origin->proof($call['namespace']);
        $root = ['items' => [], 'providers' => []];
        foreach ($call['items'] as $item) {
            $component = self::componentAt($result, $item['segments']);
            $outcome = $this->outcome($call, $item, $proof, $component);
            if ($outcome !== null) {
                [$state, $reason] = $outcome;
                self::record($item, self::sourceEffect($item), $state, $reason);
                continue;
            }
            $root['items'][] = [$item, \WeakReference::create($component)];
            $known = $this->components[$component] ?? [];
            $this->components[$component] = [...$known, $item];
            if ($item['kind'] === 'label') {
                $data = self::labelConfig($component);
                $ownership = (object) ['label' => $data['label'] ?? null, 'loss' => null];
                if (!array_key_exists('label', $data)) {
                    $ownership->loss = ['ambiguous', 'Native component did not receive a configured label'];
                }
                $this->labels[$component] = $ownership;
            }
            if ($item['kind'] === 'component') self::record($item, 'ui-created');
            if ($item['kind'] === 'provider') {
                $provider = (new \ReflectionProperty(DataSource::class, 'dataProvider'))->getValue($component);
                $root['providers'][] = ['item' => $item, 'object' => $provider,
                    'methodClass' => (new \ReflectionMethod($item['providerClass'], 'getData'))->getDeclaringClass()->getName()];
            }
        }
        $this->roots[$result] = $root;
    }

    private static function componentAt(AbstractComponent $component, array $segments): mixed
    {
        $children = new \ReflectionProperty(AbstractComponent::class, 'components');
        foreach ($segments as $segment) {
            if (!$component instanceof AbstractComponent) return null;
            $component = $children->getValue($component)[$segment] ?? null;
        }
        return $component;
    }

    private function outcome(array $call, array $item, ?array $proof, mixed $component): ?array
    {
        if ($proof === null) return ['cache-only', 'No same-run native source trace matches this UI configuration cache entry'];
        if (isset($proof['failure'])) return ['ambiguous', $proof['failure']];
        $id = $proof['origins'][$item['identity']] ?? null;
        if ($id === null) return ['ambiguous', 'The native UI converter did not establish an in-scope original declaration'];
        if ($id !== $item['id']) return ['displaced', 'A later native UI provider supplied the same declaration key'];
        $name = $item['segments'][array_key_last($item['segments'])];
        $children = $call['children'][$name] ?? [];
        if (!$component && $children === [true]) return ['disabled', 'The native UI factory skipped this disabled child'];
        if (!$component instanceof AbstractComponent || !self::native($component, UiFamily::COMPONENT_CLASSES[$item['type']])) {
            return ['ambiguous', 'The configured path did not produce the supported native PHP component class'];
        }
        if (!$call['reverse'] && in_array($item['kind'], $call['metadata'][$name] ?? [], true)) {
            return count($children) === 1
                ? ['displaced', 'Native PHP metadata merge supplied this setting']
                : ['ambiguous', 'PHP metadata targets a component name that is not unique in the instance'];
        }
        if ($item['kind'] === 'provider') {
            $provider = (new \ReflectionProperty(DataSource::class, 'dataProvider'))->getValue($component);
            if (!is_object($provider) || !self::native($provider, $item['providerClass'])) {
                return ['ambiguous', 'The actual data provider does not match the configured PHP class'];
            }
        }
        return null;
    }

    private static function sourceEffect(array $item): string
    {
        return match ($item['kind']) {
            'label' => 'ui-prepared',
            'provider' => 'ui-provider-executed',
            default => 'ui-created',
        };
    }

    private function beginFieldPreparation($subject, array $params, string $class): void
    {
        if ($class === Field::class && isset($this->labels[$subject])) $this->fieldPreparations++;
    }

    private static function labelConfig(AbstractComponent $component): array
    {
        $data = (new \ReflectionProperty(DataObject::class, '_data'))->getValue($component);
        return (array) ($data['config'] ?? []);
    }

    private function labelWrite($subject, array $params, $result, ?\Throwable $error, string $class, string $method): void
    {
        if ($error || $class !== DataObject::class || !$subject instanceof AbstractComponent) return;
        $ownership = $this->labels[$subject] ?? null;
        if (($ownership === null && $this->fieldPreparations === 0) || $ownership?->loss !== null) return;
        $key = $params[0] ?? null;
        if ($key !== 'config' && !($method === 'setData' && is_array($key))
            && !($method === 'unsetData' && $key === null)) return;
        if ($method === 'setData' && $key === 'config') {
            // The native prepare methods copy the current label as part of a config write.
            // A plugin's write has its own caller even when it uses the same label.
            $trace = LayoutRuntimeHooks::trace(DEBUG_BACKTRACE_IGNORE_ARGS | DEBUG_BACKTRACE_PROVIDE_OBJECT, 8);
            $i = 0;
            while (isset($trace[$i]) && (($trace[$i]['class'] ?? null) !== DataObject::class
                || $trace[$i]['function'] !== 'setData' || ($trace[$i]['object'] ?? null) !== $subject)) $i++;
            $setters = [DataObject::class, AbstractComponent::class];
            $subjectClass = get_class($subject);
            if (str_ends_with($subjectClass, '\\Interceptor')) $setters[] = $subjectClass;
            while (($trace[$i]['function'] ?? null) === 'setData' && ($trace[$i]['object'] ?? null) === $subject
                && in_array($trace[$i]['class'], $setters, true)) $i++;
            $caller = $trace[$i] ?? [];
            if (($caller['function'] ?? null) === 'prepare') {
                $owner = $caller['object'] ?? null;
                $prepareClass = $caller['class'] ?? null;
                if ($prepareClass === Field::class && $owner !== $subject && isset($this->labels[$owner])) {
                    // Field copies its own config into the wrapped component, then reads it back after preparation.
                    $this->labels[$subject] = $this->labels[$owner];
                    return;
                }
                if ($owner === $subject && in_array($prepareClass, [AbstractComponent::class, Field::class, Column::class], true)) return;
            }
        }
        if ($ownership !== null) $ownership->loss = ['displaced', 'PHP wrote the native component label configuration'];
    }

    private function labelLoss(AbstractComponent $component): ?array
    {
        $ownership = $this->labels[$component];
        if ($ownership->loss !== null) return $ownership->loss;
        $config = self::labelConfig($component);
        if (!array_key_exists('label', $config) || $config['label'] !== $ownership->label) {
            return ['ambiguous', 'Native component label no longer matches its tracked configuration'];
        }
        return null;
    }

    private function prepared($subject, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class === Field::class && isset($this->labels[$subject])) $this->fieldPreparations--;
        if ($error || !is_object($subject) || !$this->origin->admin()) return;
        foreach ($this->components[$subject] ?? [] as $item) {
            $expected = $item['type'] === 'button' ? AbstractComponent::class : UiFamily::COMPONENT_CLASSES[$item['type']];
            if ($class !== $expected || $item['kind'] === 'provider') continue;
            $loss = $item['kind'] === 'label' ? $this->labelLoss($subject) : null;
            if ($loss !== null) {
                self::record($item, 'ui-prepared', ...$loss);
                continue;
            }
            self::record($item, 'ui-prepared');
        }
    }

    private function beginProviderRead($subject, array $params, string $class): void
    {
        if (!in_array($class, [Listing::class, Form::class], true)) return;
        $root = $this->roots[$subject] ?? null;
        $bindings = [];
        if ($root !== null && $root['providers'] && $this->origin->admin()) {
            $context = (new \ReflectionProperty(AbstractComponent::class, 'context'))->getValue($subject);
            if (self::native($context, Context::class)) {
                $provider = (new \ReflectionProperty(Context::class, 'dataProvider'))->getValue($context);
                $bindings = array_filter($root['providers'], static fn(array $binding): bool => $binding['object'] === $provider);
            }
        }
        $this->providerReads[] = [
            'subject' => $subject, 'bindings' => $bindings, 'seen' => [],
            'provider' => reset($bindings)['object'] ?? null, 'depth' => 0, 'entered' => false,
        ];
    }

    private function beginProviderData($subject, array $params, string $class): void
    {
        $index = array_key_last($this->providerReads);
        if ($index === null) return;
        $read = &$this->providerReads[$index];
        if ($read['provider'] !== $subject) return;
        if ($read['depth'] === 0) {
            if (!self::calledFromDataSource($subject, $class, $read['subject'])) return;
            $read['entered'] = false;
        }
        $read['depth']++;
        foreach ($read['bindings'] as $binding) {
            if ($class === $binding['methodClass']) $read['entered'] = true;
        }
    }

    private static function calledFromDataSource(object $provider, string $class, object $root): bool
    {
        $trace = LayoutRuntimeHooks::trace(DEBUG_BACKTRACE_IGNORE_ARGS | DEBUG_BACKTRACE_PROVIDE_OBJECT, 8);
        foreach ($trace as $index => $frame) {
            if (($frame['object'] ?? null) !== $provider || $frame['class'] !== $class || $frame['function'] !== 'getData') continue;
            $caller = $trace[$index + 1] ?? [];
            return ($caller['object'] ?? null) === $root && $caller['function'] === 'getDataSourceData'
                && in_array($caller['class'], [Listing::class, Form::class], true);
        }
        return false;
    }

    private function providerData($subject, array $params, $result, ?\Throwable $error, string $class): void
    {
        $index = array_key_last($this->providerReads);
        if ($index === null) return;
        $read = &$this->providerReads[$index];
        if ($read['provider'] !== $subject || $read['depth'] === 0 || --$read['depth'] !== 0 || !$read['entered']) return;
        foreach ($read['bindings'] as $binding) {
            $read['seen'][$binding['item']['id']] = true;
            self::record($binding['item'], 'ui-provider-executed', $error ? 'failed' : 'observed');
        }
    }

    private function endProviderRead($subject, array $params, $result, ?\Throwable $error, string $class): void
    {
        if (!in_array($class, [Listing::class, Form::class], true)) return;
        $read = array_pop($this->providerReads);
        if ($error) return;
        foreach ($read['bindings'] as $binding) {
            if (!isset($read['seen'][$binding['item']['id']])) {
                self::record($binding['item'], 'ui-provider-executed', 'ambiguous',
                    'The native UI data path did not enter the configured data provider method');
            }
        }
    }

    private function serialized($subject, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== Result::class || $error || !is_string($result) || !$this->origin->admin()) return;
        $component = (new \ReflectionProperty(Result::class, 'component'))->getValue($subject);
        $root = $this->roots[$component] ?? null;
        if ($root === null) return;
        if (!preg_match(self::CONFIG_SCRIPT, $result, $match)) return;
        $fingerprint = hash('sha256', $match[0]);
        $items = [];
        $config = json_decode($match[1], true);
        $config = $config['*']['Magento_Ui/js/core/app']['components'] ?? [];
        foreach ($root['items'] as [$item, $reference]) {
            if ($item['kind'] === 'provider') continue;
            $node = $config[$item['namespace']] ?? [];
            if ($item['type'] !== 'dataSource') $node = $node['children'][$item['namespace']] ?? [];
            foreach ($item['segments'] as $segment) $node = $node['children'][$segment] ?? [];
            $loss = null;
            if ($item['kind'] === 'label') {
                $labelComponent = $reference->get();
                $loss = $labelComponent !== null && $labelComponent === self::componentAt($component, $item['segments'])
                    ? $this->labelLoss($labelComponent)
                    : ['ambiguous', 'The serialized UI path no longer points to the original native component'];
                if ($loss === null && !array_key_exists('label', $node['config'] ?? [])) continue;
            }
            if ($loss === null && !isset($node['type'])) continue;
            $items[$item['id']] = [$item, $loss];
        }
        ksort($items);
        if (!isset($this->scripts[$fingerprint])) {
            $this->scripts[$fingerprint] = ['items' => $items, 'ambiguous' => false];
        } elseif ($items !== $this->scripts[$fingerprint]['items']) {
            $this->scripts[$fingerprint]['items'] += $items;
            $this->scripts[$fingerprint]['ambiguous'] = true;
        }
    }

    private function sending($subject, array $params, string $class): void
    {
        if ($class !== NativeResponse::class || !$subject instanceof Response || !$this->scripts || !$this->origin->admin()) return;
        if ((new \ReflectionProperty(NativeResponse::class, 'contentSent'))->getValue($subject)) return;
        $this->sending = \WeakReference::create($subject);
    }

    private function sent($subject, array $params, $result, ?\Throwable $error, string $class): void
    {
        if ($class !== NativeResponse::class || $this->sending?->get() !== $subject) return;
        $this->sending = null;
        if ($error) return;
        $body = (new \ReflectionProperty(Message::class, 'content'))->getValue($subject);
        if (!is_string($body) || !preg_match_all(self::CONFIG_SCRIPT, $body, $matches)) return;
        foreach ($matches[0] as $script) {
            $fingerprint = hash('sha256', $script);
            $delivery = $this->scripts[$fingerprint] ?? null;
            if ($delivery === null) continue;
            foreach ($delivery['items'] as [$item, $loss]) {
                if ($delivery['ambiguous']) {
                    self::record($item, 'ui-delivered', 'ambiguous', 'Identical native UI markup has competing source traces');
                } elseif ($loss !== null) {
                    self::record($item, 'ui-delivered', ...$loss);
                } else {
                    self::record($item, 'ui-delivered');
                }
            }
            unset($this->scripts[$fingerprint]);
        }
    }

    private static function native(object $object, string $class): bool
    {
        return get_class($object) === $class || get_class($object) === $class . '\\Interceptor' && get_parent_class($object) === $class;
    }

    private static function record(array $item, string $type, string $outcome = 'observed', ?string $reason = null): void
    {
        Recorder::familyEvidence($item['id'], $type, 'adminhtml', $outcome, $reason);
    }
}
