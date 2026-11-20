<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

require '/var/www/html/app/bootstrap.php';
$hooks = dirname(getenv('MAGELENS_XML_HOOKS') ?: __DIR__ . '/../docker/php/xml-hooks.php');
require $hooks . '/xml-hooks.php';
require $hooks . '/xml-layout-manifest.php';

use Application\Blog\Controller\Index\Index;
use Application\Blog\Controller\Post\View;
use Application\Blog\Model\Posts;
use MageLens\XmlCoverage\{LayoutCoverage, LayoutManifest, LayoutRuntimeHooks};
use Magento\Framework\App\{Area, Bootstrap, RequestInterface, Response\Http};
use Magento\Framework\Controller\Result\ForwardFactory;
use Magento\Framework\View\Result\PageFactory;

$enabled = !in_array('--without-collector', $argv, true);
if ($enabled) {
    $files = [];
    foreach (['blog_index_index', 'blog_post_view'] as $handle) {
        $path = "app/code/Application/Blog/view/frontend/layout/$handle.xml";
        $source = file_get_contents(BP . '/' . $path);
        $files[] = ['path' => $path, 'family' => 'layout', 'sourceHash' => hash('sha256', $source),
            'declarations' => LayoutManifest::declarations($path, $source)];
    }
    [$collector, $callbacks] = LayoutCoverage::register(LayoutManifest::targets($files));
    foreach ($callbacks as [$class, $method, $pre, $post]) {
        if (!LayoutRuntimeHooks::register($class, $method, $pre, $post)) throw new RuntimeException("Cannot hook $class::$method");
    }
}
$objects = Bootstrap::create(BP, $_SERVER)->getObjectManager();
$objects->get(Magento\Framework\App\State::class)->setAreaCode('frontend');
$area = $objects->get(Magento\Framework\App\AreaList::class)->getArea('frontend');
foreach ([Area::PART_CONFIG, Area::PART_DESIGN] as $part) $area->load($part);
$pages = $objects->get(PageFactory::class);
$request = $objects->get(RequestInterface::class);
$request->setParam('slug', 'http-requests');
$action = $argv[1] ?? 'index';
[$controller, $route, $marker] = match ($action) {
    'index' => [new Index($pages), 'index', 'data-cy="blog"'],
    'view' => [new View($objects->get(Posts::class), $request, $pages, $objects->get(ForwardFactory::class)), 'post', 'data-cy="article-title"'],
    default => throw new InvalidArgumentException('Unknown Blog controller'),
};
$request->setRouteName('blog')->setControllerName($route)->setActionName($action);
$page = $controller->execute();
$response = $objects->create(Http::class);
$page->renderResult($response);
if (!str_contains($response->getBody(), $marker)) throw new RuntimeException("Missing native Blog $action output");
if ($enabled) $collector->finish();
echo "Verified original Blog $action constructor signature and storefront output.\n";
