<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
namespace Application\Blog\Model;

use Magento\Framework\Exception\LocalizedException;

class Validation
{
    public function text(array $data, string $field, int $max, bool $required = true): string
    {
        $value = $data[$field] ?? '';
        if (!is_scalar($value)) throw new LocalizedException(__('Invalid %1.', $field));
        $value = trim((string) $value);
        if (($required && $value === '') || mb_strlen($value) > $max) {
            throw new LocalizedException(__('%1 is required and must be at most %2 characters.', ucfirst($field), $max));
        }
        return $value;
    }

    public function slug(array $data, int $max = 160): string
    {
        $slug = $this->text($data, 'slug', $max);
        if (!preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/D', $slug)) {
            throw new LocalizedException(__('Use lowercase letters, numbers and single hyphens for the slug.'));
        }
        return $slug;
    }

    public function publication(array $data): ?string
    {
        $value = str_replace('T', ' ', $this->text($data, 'published_at', 19, false));
        if ($value === '') return null;
        if (strlen($value) === 16) $value .= ':00';
        $date = \DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $value, new \DateTimeZone('UTC'));
        if (!$date || $date->format('Y-m-d H:i:s') !== $value) throw new LocalizedException(__('Enter a valid publication date in UTC.'));
        return $value;
    }
}
