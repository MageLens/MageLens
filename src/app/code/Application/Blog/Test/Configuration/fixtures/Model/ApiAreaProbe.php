<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
namespace Application\Blog\Model;

use Magento\Framework\App\ObjectManager;
use Magento\Framework\DataObject;
use Magento\Framework\Event\ManagerInterface;

class ApiAreaProbe
{
    /** @return string[] */
    public function read(): array
    {
        $manager = ObjectManager::getInstance();
        $selected = $manager->get(__NAMESPACE__ . '\JournalAreaPreference');
        $arguments = $manager->create(__NAMESPACE__ . '\JournalArgumentAlias');
        $counter = new DataObject(['hits' => 0]);
        $manager->get(ManagerInterface::class)->dispatch('magelens_api_probe', ['counter' => $counter]);
        return [$selected::class, $arguments->label, (string) $counter->getData('hits'), $manager->get(JournalPluginSubject::class)->warm()];
    }
}
