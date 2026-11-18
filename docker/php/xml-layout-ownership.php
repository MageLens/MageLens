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

    public function __construct(private readonly \Closure $observe)
    {
    }

    public function hooks(): array
    {
        return [
            [ReaderInterface::class, 'interpret', $this->read(...), null],
            [Condition::class, 'parseConditions', $this->read(...), null],
            [Parser::class, 'parse', $this->read(...), null],
            [Flat::class, 'convert', $this->read(...), null],
            [Helper::class, 'scheduleStructure', $this->read(...), null],
        ];
    }

    private static function generated(object $object, array $parents): bool
    {
        $class = get_class($object);
        if (!str_ends_with($class, '\\Interceptor') || !in_array(get_parent_class($object), $parents, true)) return false;
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

    private static function property(object $object, string $class, string $name)
    {
        static $properties = [];
        $key = $class . '\\' . $name;
        $properties[$key] ??= new \ReflectionProperty($class, $name);
        return $properties[$key]->getValue($object);
    }

    private static function nativeParser(object $parser): bool
    {
        return self::nativeObject($parser, [Parser::class])
            && (new \ReflectionMethod($parser, 'getConverter'))->getDeclaringClass()->getName() === Parser::class;
    }

    private static function nativeCondition(object $reader): bool
    {
        return self::nativeObject($reader, [Condition::class])
            && self::nativeParser(self::property($reader, Condition::class, 'argumentParser'));
    }

    private static function dependencies(object $object): bool
    {
        if ($object instanceof Block) {
            return self::nativeParser(self::property($object, Block::class, 'argumentParser'))
                && self::nativeCondition(self::property($object, Block::class, 'conditionReader'))
                && self::nativeObject(self::property($object, Block::class, 'helper'), [Helper::class]);
        }
        if ($object instanceof UiComponent) {
            return self::nativeCondition(self::property($object, UiComponent::class, 'conditionReader'))
                && self::nativeObject(self::property($object, UiComponent::class, 'layoutHelper'), [Helper::class]);
        }
        if ($object instanceof Container) return self::nativeObject(self::property($object, Container::class, 'helper'), [Helper::class]);
        if ($object instanceof Condition) return self::nativeCondition($object);
        if ($object instanceof Parser) {
            $converter = self::property($object, Parser::class, 'converter');
            return self::nativeParser($object) && ($converter === null || self::nativeObject($converter, [Flat::class]));
        }
        return true;
    }

    private static function caller(object $object, string $method): array
    {
        $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 5);
        $caller = $trace[3] ?? [];
        if (self::interceptor($object, self::RECEIVERS) && ($caller['class'] ?? null) === get_class($object)
            && ($caller['function'] ?? null) === $method) return $trace[4] ?? [];
        return $caller;
    }

    private function read($object, array $params, string $class, string $method): void
    {
        $xml = $params[in_array($method, ['interpret', 'scheduleStructure'], true) ? 1 : 0] ?? null;
        if (!$xml instanceof \SimpleXMLElement && !$xml instanceof \DOMNode) return;
        // Generated no-plugin wrappers immediately delegate to the instrumented
        // parent. Active plugin dispatch has a different caller at that boundary.
        if ($class === get_class($object) && self::interceptor($object, self::RECEIVERS)) return;
        $caller = self::caller($object, $method);
        $valid = in_array($class, self::RECEIVERS, true) && self::nativeObject($object, self::RECEIVERS)
            && in_array($caller['class'] ?? '', [...self::RECEIVERS, Layout::class, WireframeReader::class], true)
            && self::dependencies($object);
        if ($xml instanceof \SimpleXMLElement && get_class($xml) !== Layout\Element::class) $valid = false;
        if ($xml instanceof \DOMNode && !in_array(get_class($xml), [\DOMDocument::class, \DOMElement::class], true)) $valid = false;
        ($this->observe)($xml, $valid, $method === 'interpret');
    }
}
