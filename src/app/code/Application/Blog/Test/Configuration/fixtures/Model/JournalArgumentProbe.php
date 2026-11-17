<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace Application\Blog\Model;

class JournalArgumentProbe
{
    public function __construct(public string $label, public array $options, public JournalPreferenceProbe $service)
    {
        if ($label === 'throw') throw new \DomainException('fixture constructor');
    }

    public static function exercise(): array
    {
        $om = \Magento\Framework\App\ObjectManager::getInstance();
        $chain = __NAMESPACE__ . '\\JournalArgumentChain';
        $alias = __NAMESPACE__ . '\\JournalArgumentAlias';
        $shared = $om->get($chain);
        $override = $om->create($alias, ['label' => 'caller']);
        $concrete = $om->create(self::class);
        $failed = false;
        try {
            $om->create($alias, ['label' => 'throw']);
        } catch (\DomainException) {
            $failed = true;
        }
        return ['label' => $shared->label, 'shared' => $shared === $om->get($chain), 'options' => $shared->options,
            'override' => $override->label, 'concrete' => $concrete->label, 'failed' => $failed, 'dependency' => $shared->service instanceof JournalPreferenceProbe];
    }
}
