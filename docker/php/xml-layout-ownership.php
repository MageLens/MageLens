<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

use Magento\Framework\Config\Converter\Dom\Flat;
use Magento\Framework\View\Layout;
use Magento\Framework\View\Layout\Argument\Parser;
use Magento\Framework\View\Layout\ReaderInterface;
use Magento\Framework\View\Layout\ReaderPool;
use Magento\Framework\View\Layout\Reader\Block;
use Magento\Framework\View\Layout\Reader\Container;
use Magento\Framework\View\Layout\Reader\Move;
use Magento\Framework\View\Layout\Reader\UiComponent;
use Magento\Framework\View\Layout\Reader\Visibility\Condition;
use Magento\Framework\View\Layout\ScheduledStructure\Helper;
use Magento\Framework\View\Page\Config\Reader\{Body, Head, Html};
use Magento\Framework\View\Page\Layout\Reader as WireframeReader;
use Magento\Backend\Model\View\Layout\Reader\Block as BackendBlock;

/** Verify the native receivers before giving them an originating mutable node. */
final class LayoutXmlOwnership
{
    private const READERS = [ReaderPool::class, Block::class, BackendBlock::class, Container::class,
        Move::class, UiComponent::class, Body::class, Head::class, Html::class];
    private const RECEIVERS = [...self::READERS, Condition::class, Parser::class, Flat::class, Helper::class];
    private array $watched = [];
    private array $errors = [];
    private array $wrappers = [];
    private int $wrapperOverflow = 0;

    public function __construct(private readonly \Closure $observe, private readonly \Closure $unverifiedProducer)
    {
    }

    public function finish(): void
    {
        if ($this->wrappers || $this->wrapperOverflow) $this->errors['Unbalanced XML handoff hook evidence'] = true;
        if ($this->errors) throw new \RuntimeException(implode(', ', array_keys($this->errors)));
    }

    public function hooks(): array
    {
        return [
            [ReaderInterface::class, 'interpret', $this->read(...), $this->endWrapper(...)],
            ...array_map(fn($target) => [$target[0], $target[1],
                function ($object, array $params, string $class, string $method) use ($target): void {
                    if ($class === $target[0]) $this->read($object, $params, $class, $method);
                }, null], [[Condition::class, 'parseConditions'], [Parser::class, 'parse'],
                    [Flat::class, 'convert'], [Helper::class, 'scheduleStructure']]),
            [\Magento\Framework\Interception\PluginListInterface::class, 'getNext', null, $this->pluginSelection(...)],
        ];
    }

    private static function generated(object $object, array $parents): bool
    {
        $class = get_class($object);
        if ($class !== get_parent_class($object) . '\\Interceptor' || !in_array(get_parent_class($object), $parents, true)) return false;
        $file = (new \ReflectionClass($object))->getFileName();
        return is_string($file) && str_starts_with($file, BP . '/generated/code/');
    }

    private static function interceptor(object $object, array $parents): bool
    {
        return $object instanceof \Magento\Framework\Interception\InterceptorInterface && self::generated($object, $parents);
    }

    private static function nativeObject(object $object, array $classes): bool
    {
        if (in_array(get_class($object), $classes, true) || self::interceptor($object, $classes)) return true;
        if (!self::generated($object, $classes)) return false;
        // The installed optimized compiler can emit a constructor-only subclass
        // without Magento's interception interface. Its consumers are inherited.
        foreach ((new \ReflectionClass($object))->getMethods() as $method) {
            if ($method->getDeclaringClass()->getName() === get_class($object) && !$method->isConstructor()) return false;
        }
        return true;
    }

    public static function nativeMethod(object $object, string $native, string $method): bool
    {
        $parents = [$native];
        if ($native === \Magento\Framework\View\Model\Layout\Merge::class) {
            $parents[] = 'Hyva\\Theme\\Framework\\View\\Model\\Layout\\Merge';
        }
        if ($native === Block::class) $parents[] = BackendBlock::class;
        if ($native === \Magento\Framework\ObjectManager\ObjectManager::class) {
            $parents[] = \Magento\Framework\App\ObjectManager::class;
        }
        $parents = self::renderingParents($object, $native, $method, $parents);
        if (!in_array(get_class($object), $parents, true) && !self::generated($object, $parents)) return false;
        $owner = (new \ReflectionMethod($object, $method))->getDeclaringClass()->getName();
        return $owner === $native || ($owner === get_class($object) && self::interceptor($object, $parents));
    }

    public function watchProducer(object $object, string $native, string $method, \Closure $pre, \Closure $post): void
    {
        if (!self::interceptor($object, self::renderingParents($object, $native, $method, [$native]))
            || (new \ReflectionMethod($object, $method))->getDeclaringClass()->getName() !== get_class($object)) return;
        $class = get_class($object);
        $key = $class . '::' . $method;
        if (isset($this->watched[$key])) return;
        if (count($this->watched) >= 1024) {
            $this->errors['Generated layout producer hook registrations exceeded 1024 methods'] = true;
            return;
        }
        $this->watched[$key] = true;
        if (!\OpenTelemetry\Instrumentation\hook($class, $method,
            static function ($object, array $params, string $scope, string $method) use ($class, $pre): void {
                if ($scope === $class) $pre($object, $params, $scope, $method);
            },
            static function ($object, array $params, $result, ?\Throwable $error, string $scope, string $method) use ($class, $post): void {
                if ($scope === $class) $post($object, $params, $result, $error, $scope, $method);
            })) {
            $this->errors['Cannot register generated layout producer hook'] = true;
        }
    }

    // Inherited native methods can still invoke a subclass's property hook or
    // magic access after unset(). Inspect metadata without reading application
    // properties. Plain redeclarations keep the same native storage semantics.
    public static function unhookedProperty(object $object, string $name): ?\ReflectionProperty
    {
        // isInitialized() itself initializes lazy objects on the pinned PHP
        // engine. Inspect object metadata before inspecting its property.
        if ((new \ReflectionClass($object))->isUninitializedLazyObject($object)) return null;
        $property = new \ReflectionProperty($object, $name);
        return !$property->getHooks() && $property->isInitialized($object) ? $property : null;
    }

    private static function renderingParents(object $object, string $native, string $method, array $parents): array
    {
        if (!in_array($native, [\Magento\Framework\View\Element\Template::class,
            \Magento\Framework\View\Element\Template\File\Resolver::class,
            \Magento\Framework\View\TemplateEngine\Php::class], true) || !$object instanceof $native) return $parents;
        $parent = get_parent_class($object);
        if ($parent && is_a($parent, $native, true)
            && (new \ReflectionMethod($parent, $method))->getDeclaringClass()->getName() === $native) $parents[] = $parent;
        if ((new \ReflectionMethod($object, $method))->getDeclaringClass()->getName() === $native) $parents[] = get_class($object);
        return array_values(array_unique($parents));
    }

    private static function property(object $object, string $class, string $name)
    {
        static $properties = [];
        $key = $class . '\\' . $name;
        $properties[$key] ??= new \ReflectionProperty($class, $name);
        return $properties[$key]->getValue($object);
    }

    private function watch(object $object, string $native, string $method): void
    {
        if (!self::interceptor($object, [$native])
            || (new \ReflectionMethod($object, $method))->getDeclaringClass()->getName() !== get_class($object)) return;
        $class = get_class($object);
        $key = $class . '::' . $method;
        if (isset($this->watched[$key])) return;
        $this->watched[$key] = true;
        if (!\OpenTelemetry\Instrumentation\hook($class, $method,
            function ($object, array $params, string $scope, string $method) use ($class): void {
                if ($scope === $class) $this->read($object, $params, $scope, $method);
            },
            function ($object, array $params, $result, ?\Throwable $error, string $scope, string $method) use ($class): void {
                if ($scope === $class) $this->endWrapper($object, $params, $result, $error, $scope, $method);
            })) {
            $this->errors['Cannot register generated XML receiver hook'] = true;
        }
    }

    private function nativeParser(object $parser): bool
    {
        $this->watch($parser, Parser::class, 'parse');
        return self::nativeObject($parser, [Parser::class])
            && self::nativeMethod($parser, Parser::class, 'parse')
            && (new \ReflectionMethod($parser, 'getConverter'))->getDeclaringClass()->getName() === Parser::class;
    }

    private function nativeCondition(object $reader): bool
    {
        $this->watch($reader, Condition::class, 'parseConditions');
        return self::nativeObject($reader, [Condition::class])
            && self::nativeMethod($reader, Condition::class, 'parseConditions')
            && $this->nativeParser(self::property($reader, Condition::class, 'argumentParser'));
    }

    private function nativeHelper(object $helper): bool
    {
        $this->watch($helper, Helper::class, 'scheduleStructure');
        return self::nativeObject($helper, [Helper::class]) && self::nativeMethod($helper, Helper::class, 'scheduleStructure');
    }

    private function dependencies(object $object): bool
    {
        if ($object instanceof Block) {
            return $this->nativeParser(self::property($object, Block::class, 'argumentParser'))
                && $this->nativeCondition(self::property($object, Block::class, 'conditionReader'))
                && $this->nativeHelper(self::property($object, Block::class, 'helper'));
        }
        if ($object instanceof UiComponent) {
            return $this->nativeCondition(self::property($object, UiComponent::class, 'conditionReader'))
                && $this->nativeHelper(self::property($object, UiComponent::class, 'layoutHelper'));
        }
        if ($object instanceof Container) return $this->nativeHelper(self::property($object, Container::class, 'helper'));
        if ($object instanceof Condition) return $this->nativeCondition($object);
        if ($object instanceof Parser) {
            $converter = self::property($object, Parser::class, 'converter');
            if ($converter !== null) $this->watch($converter, Flat::class, 'convert');
            return $this->nativeParser($object) && ($converter === null || self::nativeMethod($converter, Flat::class, 'convert'));
        }
        return true;
    }

    public static function caller(object $object, string $method, bool $unwrap = true): array
    {
        $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS | DEBUG_BACKTRACE_PROVIDE_OBJECT, 24);
        foreach ($trace as $index => $frame) {
            if (($frame['function'] ?? null) !== $method || !isset($frame['class']) || !is_a($object, $frame['class'])) continue;
            $caller = $trace[$index + 1] ?? [];
            if ($unwrap && str_ends_with(get_class($object), '\\Interceptor')
                && ($caller['class'] ?? null) === get_class($object) && ($caller['function'] ?? null) === $method) {
                return $trace[$index + 2] ?? [];
            }
            return $caller;
        }
        return [];
    }

    public static function bodyMatches(\ReflectionFunctionAbstract $function, string $expected): bool
    {
        $file = $function->getFileName();
        if (!is_string($file) || !is_readable($file) || realpath($file) !== $file || filesize($file) > 262144) return false;
        $source = implode('', array_slice(file($file), $function->getStartLine() - 1,
            $function->getEndLine() - $function->getStartLine() + 1));
        $start = strpos($source, '{');
        $end = strrpos($source, '}');
        if ($start === false || $end === false || $end < $start) return false;
        $source = substr($source, $start, $end - $start + 1);
        $tokens = static function (string $code): string {
            $parts = [];
            foreach (token_get_all('<?php ' . $code) as $token) {
                if (is_array($token)) {
                    if (!in_array($token[0], [T_OPEN_TAG, T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)) $parts[] = $token[1];
                } else $parts[] = $token;
            }
            return implode('', $parts);
        };
        return $tokens($source) === $tokens($expected);
    }

    public static function configurationScope(object $object): ?string
    {
        if (!(new \ReflectionObject($object))->hasProperty('____scope')) return null;
        $scope = (new \ReflectionProperty($object, '____scope'))->getValue($object);
        if (!$scope instanceof \Magento\Framework\Config\Scope
            || (new \ReflectionMethod($scope, 'getCurrentScope'))->getDeclaringClass()->getName() !== \Magento\Framework\Config\Scope::class) return null;
        $value = (new \ReflectionProperty(\Magento\Framework\Config\Scope::class, '_currentScope'))->getValue($scope);
        return is_string($value) && strlen($value) <= 64 ? $value : null;
    }

    private function read($object, array $params, string $class, string $method): void
    {
        $xml = $params[in_array($method, ['interpret', 'scheduleStructure'], true) ? 1 : 0] ?? null;
        if (!$xml instanceof \SimpleXMLElement && !$xml instanceof \DOMNode) return;
        if ($class === get_class($object) && self::interceptor($object, self::RECEIVERS)) {
            $this->pushFrame(['object' => $object, 'method' => $method, 'xml' => $xml, 'producer' => false,
                'wrapper' => true, 'query' => null, 'parent' => false, 'trusted' => false]);
            return;
        }
        $caller = self::caller($object, $method);
        $valid = in_array($class, self::RECEIVERS, true) && self::nativeObject($object, self::RECEIVERS)
            && self::nativeMethod($object, $class, $method)
            && in_array($caller['class'] ?? '', [...self::RECEIVERS, Layout::class, WireframeReader::class], true)
            && $this->dependencies($object);
        if ($xml instanceof \SimpleXMLElement && get_class($xml) !== Layout\Element::class) $valid = false;
        if ($xml instanceof \DOMNode && !in_array(get_class($xml), [\DOMDocument::class, \DOMElement::class], true)) $valid = false;
        if (self::interceptor($object, self::RECEIVERS)
            && (new \ReflectionMethod($object, $method))->getDeclaringClass()->getName() === get_class($object)) {
            $index = $this->wrapperFrame($object, $method);
            if ($index === null || $this->wrapperOverflow) {
                if ($valid) $this->errors['Missing generated XML receiver hook evidence'] = true;
                $valid = false;
            } else {
                $this->wrappers[$index]['parent'] = true;
                $original = $this->wrappers[$index]['xml'];
                $node = $xml instanceof \DOMNode ? $xml : dom_import_simplexml($xml);
                $source = $original instanceof \DOMNode ? $original : dom_import_simplexml($original);
                $valid = $valid && $this->wrappers[$index]['query'] !== false && $node->isSameNode($source);
                $this->wrappers[$index]['trusted'] = $valid;
            }
        }
        ($this->observe)($xml, $valid, $method === 'interpret');
    }

    private function wrapperFrame(object $object, string $method): ?int
    {
        for ($index = count($this->wrappers) - 1; $index >= 0; $index--) {
            if ($this->wrappers[$index]['object'] === $object && $this->wrappers[$index]['method'] === $method) return $index;
        }
        return null;
    }

    private function pushFrame(array $frame): void
    {
        if ($this->wrapperOverflow || count($this->wrappers) >= 256) {
            $this->wrapperOverflow++;
            $this->errors['XML handoff nesting exceeded 256 calls'] = true;
            if ($frame['xml'] !== null) ($this->observe)($frame['xml'], false, false);
            else ($this->unverifiedProducer)($frame['object'], $frame['method']);
            return;
        }
        $this->wrappers[] = $frame;
    }

    public function beginProducer(object $object, string $native, string $class, string $method, bool $consumer, bool $delegated): void
    {
        $wrapper = $class === get_class($object) && self::interceptor($object, [get_parent_class($object)]);
        $trusted = !$wrapper && $class === $native && self::nativeMethod($object, $native, $method) && $consumer;
        if (!$wrapper && self::interceptor($object, [get_parent_class($object)])
            && (new \ReflectionMethod($object, $method))->getDeclaringClass()->getName() === get_class($object)) {
            $index = $this->wrapperFrame($object, $method);
            if ($index !== null && $this->wrappers[$index]['producer'] && $this->wrappers[$index]['wrapper']) {
                $this->wrappers[$index]['parent'] = true;
                $trusted = $trusted && $delegated && $this->wrappers[$index]['query'] !== false;
                $this->wrappers[$index]['trusted'] = $trusted;
            } else {
                if ($trusted && $delegated) {
                    $this->errors['Missing generated layout producer hook evidence for ' . get_class($object) . '::' . $method] = true;
                }
                $trusted = false;
            }
        }
        $this->pushFrame(['object' => $object, 'method' => $method, 'xml' => null, 'producer' => true,
            'wrapper' => $wrapper, 'query' => null, 'parent' => false, 'trusted' => $trusted]);
    }

    public function producerDepth(object $object, string $method): int
    {
        return count(array_filter($this->wrappers, static fn($frame) => $frame['producer']
            && $frame['object'] === $object && $frame['method'] === $method));
    }

    public function producerTrusted(object $object, string $method): bool
    {
        $index = $this->wrapperFrame($object, $method);
        return $index !== null && $this->wrappers[$index]['producer'] && $this->wrappers[$index]['trusted'];
    }

    public function endProducer(object $object, string $method, ?\Throwable $error): array
    {
        if ($this->wrapperOverflow) {
            $this->wrapperOverflow--;
            return ['trusted' => false, 'final' => true];
        }
        $frame = array_pop($this->wrappers);
        if (!$frame || !$frame['producer'] || $frame['object'] !== $object || $frame['method'] !== $method) {
            $this->errors['Unbalanced layout producer hook evidence'] = true;
            return ['trusted' => false, 'final' => true];
        }
        if (!$error && $frame['wrapper'] && $frame['query'] === true && !$frame['parent']) {
            $this->errors['Missing native layout producer hook evidence'] = true;
        }
        return ['trusted' => $frame['trusted'], 'final' => $this->wrapperFrame($object, $method) === null];
    }

    private function pluginSelection($list, array $params, $result, ?\Throwable $error): void
    {
        $index = array_key_last($this->wrappers);
        if ($index === null || $this->wrapperOverflow) return;
        $frame = $this->wrappers[$index];
        if (!$frame['wrapper']) return;
        $caller = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[2] ?? [];
        if (($caller['class'] ?? null) !== get_class($frame['object']) || ($caller['function'] ?? null) !== $frame['method']
            || ($params[0] ?? null) !== get_parent_class($frame['object']) || ($params[1] ?? null) !== $frame['method']) return;
        $this->wrappers[$index]['query'] = !$error && !$result;
        if ($error || $result) {
            if ($frame['xml'] !== null) ($this->observe)($frame['xml'], false, false);
            else ($this->unverifiedProducer)($frame['object'], $frame['method']);
        }
    }

    private function endWrapper($object, array $params, $result, ?\Throwable $error, string $class, string $method): void
    {
        if ($class !== get_class($object) || !self::interceptor($object, self::RECEIVERS)) return;
        if ($this->wrapperOverflow) { $this->wrapperOverflow--; return; }
        $frame = array_pop($this->wrappers);
        if (!$frame || $frame['object'] !== $object || $frame['method'] !== $method) {
            $this->errors['Unbalanced generated XML receiver hook evidence'] = true;
            return;
        }
        if (!$frame['trusted']) ($this->observe)($frame['xml'], false, false);
        if (!$error && $frame['query'] === true && !$frame['parent']) {
            $this->errors['Missing native XML receiver hook evidence'] = true;
        }
    }
}
