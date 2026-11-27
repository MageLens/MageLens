<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\XmlCoverage;

final class LayoutArgumentEvaluation
{
    public int $parameterNext = 0;
    public bool $parameterBaseObserved = false;
    public bool $parameterBaseTrusted = false;
    public bool $parameterMapEntered = false;
    public bool $parameterMapObserved = false;
    public bool $itemsEntered = false;
    public bool $itemsObserved = false;
    public ?object $sorter = null;
    public bool $sortInputConfirmed = false;
    public array $items = [];
    public int $itemNext = 0;
    public array $arrayOperandsApplied = [];
    public int $configuredNext = 0;
    public array $configuredValues = [];
    public ?LayoutConfiguredObjectResult $configuredCreate = null;
    public bool $lookupEntered = false;
    public bool $lookup = false;
    public bool $trustedLookup = false;
    public bool $deferred = false;

    public function __construct(
        public readonly int $batch,
        public readonly string|int|null $name,
        public readonly bool $root,
        public readonly object $object,
        public readonly ?array $type,
        public readonly array $children,
        public readonly array $modifierInputs,
        public readonly array $parameters,
        public readonly ?array $parameter,
        public readonly ?int $namedParameterParent,
        public readonly ?array $arrayOperand,
        public readonly array $configuredArguments,
        public readonly ?array $configuredChild,
        public readonly ?array $itemInput,
        public readonly ?array $input,
        public ?array $forwarded,
        public bool $expectedType,
        public readonly ?array $dispatchInput,
        public readonly ?array $dispatchType,
    ) {}
}

final readonly class LayoutConfiguredArgumentInput
{
    public function __construct(public int|string $key, public array $origin, public ?array $input) {}
}

final readonly class LayoutConfiguredObjectResult
{
    public function __construct(public ?\WeakReference $object, public array $supplied) {}
}
