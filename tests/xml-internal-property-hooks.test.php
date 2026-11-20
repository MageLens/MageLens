<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

$object = new class { protected int $value = 0; };
$foreign = new class { protected int $value = 0; };
$property = new class($object, 'value') extends ReflectionProperty {
    public int $reads = 0;
    public function getName(): string { $this->reads++; return 'unrelated'; }
    public function getDeclaringClass(): ReflectionClass { $this->reads++; return new ReflectionClass(stdClass::class); }
};
$nativeOnly = in_array('--without-collector', $argv, true);
$late = in_array('--late-registration', $argv, true);
if ($late) $property->setValue($object, 0);
$name = new ReflectionMethod(ReflectionProperty::class, 'getName');
$declaration = new ReflectionMethod(ReflectionProperty::class, 'getDeclaringClass');
$counts = ['pre' => 0, 'post' => 0, 'errors' => 0];
if (!$nativeOnly) foreach (['setValue', 'setRawValue', 'setRawValueWithoutLazyInitialization'] as $method) {
    $registered = OpenTelemetry\Instrumentation\hook(ReflectionProperty::class, $method,
        static function ($property, array $params) use ($object, &$counts, $name, $declaration): void {
            if (($params[0] ?? null) !== $object) return;
            if (!$property instanceof ReflectionProperty || $name->invoke($property) !== 'value'
                || $declaration->invoke($property)->getName() !== get_class($object)) throw new RuntimeException('Internal property receiver changed');
            $counts['pre']++;
        }, static function ($property, array $params, $result, ?Throwable $error) use ($object, &$counts, $name, $declaration): void {
            if (($params[0] ?? null) !== $object) return;
            if (!$property instanceof ReflectionProperty || $name->invoke($property) !== 'value'
                || $declaration->invoke($property)->getName() !== get_class($object)) throw new RuntimeException('Internal property completion changed');
            $counts['post']++;
            if ($error !== null) $counts['errors']++;
        });
    if (!$registered) throw new RuntimeException('Cannot observe native internal property method: ' . $method);
}
$property->setValue($object, 1);
$property->setRawValue($object, 2);
$property->setRawValueWithoutLazyInitialization($object, 3);
try {
    $property->setValue($object, 'invalid');
    throw new LogicException('Expected native typed-property rejection');
} catch (TypeError) {
}
(new ReflectionProperty($foreign, 'value'))->setRawValue($foreign, 3);
$expected = $nativeOnly ? ['pre' => 0, 'post' => 0, 'errors' => 0]
    : ($late ? ['pre' => 2, 'post' => 2, 'errors' => 0] : ['pre' => 4, 'post' => 4, 'errors' => 1]);
if ($counts !== $expected || $property->getRawValue($object) !== 3 || $property->reads !== 0) {
    throw new RuntimeException('Native internal property hooks lost receiver, completion or exception evidence: ' . json_encode($counts) . '; metadata reads=' . $property->reads);
}
echo $late ? "Late internal hook registration misses previously called methods; this path cannot claim observed writes.\n"
    : "Internal reflection writes preserve native effects, exact receiver identity, passive metadata and failed-call completion evidence.\n";
