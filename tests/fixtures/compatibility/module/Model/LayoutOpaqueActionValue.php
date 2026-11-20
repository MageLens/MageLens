<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace MageLens\Compatibility\Model;

class LayoutOpaqueActionValue implements \ArrayAccess
{
    public static int $serializations = 0;
    public function offsetExists(mixed $offset): bool { return false; }
    public function offsetGet(mixed $offset): mixed { return null; }
    public function offsetSet(mixed $offset, mixed $value): void { throw new \LogicException('Unexpected opaque value write'); }
    public function offsetUnset(mixed $offset): void { throw new \LogicException('Unexpected opaque value unset'); }
    public function __serialize(): array { self::$serializations++; return []; }
}
