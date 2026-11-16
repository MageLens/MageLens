<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace Application\Blog\Model;

class JournalPreferenceProbe
{
    public static function exercise(): array
    {
        $om = \Magento\Framework\App\ObjectManager::getInstance();
        $first = $om->get(__NAMESPACE__ . '\\JournalFirst');
        $second = $om->get(__NAMESPACE__ . '\\JournalSecond');
        $chain = $om->get(__NAMESPACE__ . '\\JournalChain');
        $direct = $om->get(self::class);
        $created = $om->create(__NAMESPACE__ . '\\JournalFirst');
        $area = $om->get(__NAMESPACE__ . '\\JournalAreaPreference');
        $external = $om->get(__NAMESPACE__ . '\\JournalExternalPreference');
        $virtual = $om->get(__NAMESPACE__ . '\\JournalVirtualPreference');
        $lookup = $om->get(\Magento\Framework\ObjectManager\ConfigInterface::class)->getPreference(__NAMESPACE__ . '\\JournalUnusedPreference');
        $failed = false;
        try {
            $om->create(__NAMESPACE__ . '\\JournalFailedPreference');
        } catch (\ReflectionException $error) {
            $failed = true;
        }
        return ['shared' => $first === $second && $first === $chain && $first === $direct,
            'fresh' => $created instanceof self && $created !== $first, 'area' => $area::class,
            'external' => $external::class, 'virtual' => $virtual::class, 'lookup' => $lookup, 'failed' => $failed];
    }
}
