<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
namespace Application\Blog\Model;

use Magento\Framework\App\Filesystem\DirectoryList;
use Magento\Framework\Exception\LocalizedException;
use Magento\Framework\Filesystem;
use Magento\MediaStorage\Model\File\UploaderFactory;
use Magento\Framework\Image\AdapterFactory;

class Images
{
    public function __construct(private Filesystem $filesystem, private UploaderFactory $uploaders, private AdapterFactory $adapters) {}
    public function upload(array $file): ?string
    {
        if (!$file || ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) return null;
        if (($file['error'] ?? 1) !== UPLOAD_ERR_OK || ($file['size'] ?? 0) > 5 * 1024 * 1024) {
            throw new LocalizedException(__('Upload a JPG or PNG image of at most 5 MB.'));
        }
        $uploader = $this->uploaders->create(['fileId' => 'featured_image']);
        $uploader->setAllowedExtensions(['jpg', 'jpeg', 'png']);
        if (!$uploader->checkMimeType(['image/jpeg', 'image/png'])) throw new LocalizedException(__('The uploaded file must be an image.'));
        $uploader->addValidateCallback('image', $this->adapters->create(), 'validateUploadFile');
        $media = $this->filesystem->getDirectoryWrite(DirectoryList::MEDIA);
        $media->create('application/blog');
        $name = bin2hex(random_bytes(16)) . '.' . strtolower(pathinfo((string) $file['name'], PATHINFO_EXTENSION));
        try { $result = $uploader->save($media->getAbsolutePath('application/blog'), $name); }
        catch (\Exception $error) { throw new LocalizedException(__('Unable to save this image.'), $error); }
        if (!$result) throw new LocalizedException(__('Unable to save this image.'));
        return 'application/blog/' . basename($result['file']);
    }
    public function delete(?string $image): void
    {
        if ($image && preg_match('~^application/blog/[a-f0-9]{32}\.(jpg|jpeg|png)$~D', $image)) {
            $this->filesystem->getDirectoryWrite(DirectoryList::MEDIA)->delete($image);
        }
    }
}
