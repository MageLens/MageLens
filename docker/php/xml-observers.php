<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

require_once __DIR__ . '/xml-observer-manifest.php';

use Magento\Framework\Event\{Config, Manager, Observer, ObserverFactory, ObserverInterface};
use Magento\Framework\Event\Config\Data;
use Magento\Framework\Event\Invoker\InvokerDefault;

final class Observers
{
    private static array $targets = [];
    private static array $events = [];
    private static array $managers = [];
    private static array $invokers = [];
    private static array $calls = [];
    private static array $classes = [];
    private static bool $configSeen = false;
    private static array $errors = [];
    private static ?array $probe = null;

    public static function hooks(array $targets): array
    {
        self::$targets = $targets;
        foreach ($targets as $area) self::$events += $area;
        if (!$targets) return [];
        return [
            [Manager::class, 'dispatch',
                static function ($subject, array $args, string $class) {
                    if ($class !== Manager::class) return;
                    $event = mb_strtolower($args[0] ?? '');
                    self::$managers[] = ['event' => $event, 'target' => isset(self::$events[$event]), 'ready' => false, 'active' => false, 'subject' => $subject];
                },
                static function ($subject, array $args, $result, ?\Throwable $error, string $class) {
                    if ($class !== Manager::class) return;
                    $frame = array_pop(self::$managers);
                    if ($frame['target'] && !$frame['ready'] && !$error) self::error('Native event configuration hook was bypassed');
                }],
            [Config::class, 'getObservers', null,
                static function ($subject, array $args, $result, ?\Throwable $error, string $class) {
                    if (!$error && $subject instanceof Config) self::configured($subject, $args[0], $result, $class === Config::class);
                }],
            [InvokerDefault::class, 'dispatch',
                static function ($subject, array $args, string $class) {
                    if ($class === InvokerDefault::class) self::enterInvoker($subject, $args[0], $args[1]);
                },
                static function ($subject, array $args, $result, ?\Throwable $error, string $class) {
                    if ($class !== InvokerDefault::class) return;
                    $frame = array_pop(self::$invokers);
                    if (isset($frame['manager'])) self::$managers[$frame['manager']]['active'] = false;
                }],
            [InvokerDefault::class, '_callObserverMethod',
                static function ($subject, array $args, string $class) {
                    if ($class === InvokerDefault::class) self::enterCall($subject, $args[0], $args[1]);
                },
                static function ($subject, array $args, $result, ?\Throwable $error, string $class) {
                    if ($class === InvokerDefault::class) array_pop(self::$calls);
                }],
            [ObserverInterface::class, 'execute',
                static function ($subject, array $args, string $class) {
                    self::execute($subject, $class);
                }, null],
        ];
    }

    private static function error(string $message): void
    {
        self::$errors[$message] = true;
    }

    private static function configured(Config $subject, string $event, $result, bool $native): void
    {
        $index = array_key_last(self::$managers);
        if ($index === null || self::$managers[$index]['event'] !== $event || self::$managers[$index]['active']) return;
        if ($native) {
            self::$configSeen = true;
            self::$managers[$index]['ready'] = true;
        }
        if (!self::$managers[$index]['target']) return;
        try {
            static $dataProperty, $scopeProperty, $invokerProperty;
            $dataProperty ??= new \ReflectionProperty(Config::class, '_dataContainer');
            $scopeProperty ??= new \ReflectionProperty(Data::class, '_configScope');
            $scope = $scopeProperty->getValue($dataProperty->getValue($subject))->getCurrentScope();
            $area = $scope === 'primary' ? 'global' : $scope;
            $entry = self::$targets[$area][$event] ?? null;
            if (!$entry) return;
            $hash = $scope === 'primary' ? $entry['primaryHash'] : $entry['hash'];
            if (!is_array($result) || ObserverManifest::signature($result) !== $hash) {
                self::error('Cached event registrations differ from current XML provenance; use --refresh-cache');
                return;
            }
            if (!empty($entry['targets'])) {
                $invokerProperty ??= new \ReflectionProperty(Manager::class, '_invoker');
                $invoker = $invokerProperty->getValue(self::$managers[$index]['subject']);
                if (!$invoker instanceof InvokerDefault
                    || (new \ReflectionMethod(ObserverManifest::nativeClass(get_class($invoker)), 'dispatch'))->getDeclaringClass()->getName() !== InvokerDefault::class) {
                    self::error('Runtime event invoker differs from prepared XML provenance');
                    return;
                }
            }
            self::$managers[$index]['area'] = $area;
            self::$managers[$index]['targets'] = $entry['targets'] ?? [];
        } catch (\Throwable) {
            self::error('Cannot validate Magento event configuration scope');
        }
    }

    private static function enterInvoker(InvokerDefault $subject, array $config, Observer $observer): void
    {
        $index = array_key_last(self::$managers);
        $frame = self::$managers[$index] ?? [];
        $target = $frame['targets'][$config['name'] ?? ''] ?? null;
        $context = null;
        if (self::$probe !== null && $subject === self::$probe['invoker']) {
            self::$probe['dispatch'] = true;
        } elseif ($target && !$frame['active']) {
            if (self::calledByManager()) {
                if (ObserverManifest::signature($config) !== $target['hash']) {
                    self::error('Runtime observer registration differs from current XML provenance');
                } else {
                    $context = ['manager' => $index, 'subject' => $subject, 'wrapper' => $observer,
                        'id' => $target['id'], 'class' => $target['class'], 'area' => $frame['area'],
                        'event' => $frame['event'], 'observer' => $config['name']];
                    self::$managers[$index]['active'] = true;
                }
            }
        }
        self::$invokers[] = $context;
    }

    private static function calledByManager(): bool
    {
        // The invoker must have been called at the native manager call site,
        // including through its generated interceptor. A separate dispatch
        // from a plugin while the manager is on the stack carries no identity.
        static $managerFile;
        $managerFile ??= (new \ReflectionMethod(Manager::class, 'dispatch'))->getFileName();
        $invokerDispatches = 0;
        foreach (debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 32) as $caller) {
            if ($caller['function'] !== 'dispatch') continue;
            $class = $caller['class'] ?? '';
            if ($class === InvokerDefault::class && ++$invokerDispatches > 1) return false;
            if (($class === InvokerDefault::class || $class === InvokerDefault::class . '\\Interceptor')
                && ($caller['file'] ?? '') === $managerFile) return true;
            if ($class === Manager::class) return false;
        }
        return false;
    }

    private static function enterCall(InvokerDefault $subject, $object, Observer $observer): void
    {
        $context = end(self::$invokers);
        $call = null;
        if (self::$probe !== null && $subject === self::$probe['invoker']) {
            self::$probe['call'] = true;
        } elseif ($context && $context['subject'] === $subject && $context['wrapper'] === $observer) {
            try {
                if (!$object instanceof ObserverInterface) throw new \LogicException();
                $type = get_class($object);
                $native = self::$classes[$type] ??= (new \ReflectionMethod(ObserverManifest::nativeClass($type), 'execute'))->getDeclaringClass()->getName();
                if ($native !== $context['class']) throw new \LogicException();
                $call = $context + ['object' => $object];
            } catch (\Throwable) {
                self::error('Runtime observer implementation differs from prepared XML provenance');
            }
        }
        self::$calls[] = $call;
    }

    private static function execute($subject, string $class): void
    {
        if (self::$probe !== null && $subject === self::$probe['observer']) {
            self::$probe['execute'] = true;
            return;
        }
        $key = array_key_last(self::$calls);
        $call = self::$calls[$key] ?? null;
        if (!$call || $call['object'] !== $subject || $call['class'] !== $class
            || $call['manager'] !== array_key_last(self::$managers)
            || end(self::$invokers) === null) return;
        // The declared method is reached after Magento's generated interceptor
        // delegates. Count at most once for the registration in this invocation.
        self::$calls[$key] = null;
        Recorder::observer($call['id'], $call['area'], $call['event'], $call['observer']);
    }

    public static function finish(): bool
    {
        if (self::$managers || self::$invokers || self::$calls) self::error('Unbalanced native observer hook context');
        if (self::$errors) throw new \RuntimeException(implode('; ', array_keys(self::$errors)));
        if (!self::$targets || !self::$configSeen) return false;
        // The no-op uses the installed invoker and interface in this PHP request,
        // including when the browser did not execute a single eligible observer.
        $observer = new class implements ObserverInterface {
            public function execute(Observer $observer) {}
        };
        $factory = new class($observer) extends ObserverFactory {
            public function __construct(private ObserverInterface $observer) {}
            public function get($className) { return $this->observer; }
        };
        $state = (new \ReflectionClass(\Magento\Framework\App\State::class))->newInstanceWithoutConstructor();
        $invoker = new InvokerDefault($factory, $state, new \Psr\Log\NullLogger());
        self::$probe = ['invoker' => $invoker, 'observer' => $observer];
        try {
            $invoker->dispatch(['instance' => get_class($observer)], new Observer());
            if (!(self::$probe['dispatch'] ?? false) || !(self::$probe['call'] ?? false) || !(self::$probe['execute'] ?? false)
                || self::$invokers || self::$calls) {
                throw new \RuntimeException('Native observer execution hook did not pass its self-check');
            }
        } finally {
            self::$probe = null;
        }
        return true;
    }
}
