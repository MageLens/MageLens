<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

// Small result/config doubles exercise the real isolated controller without
// requiring a Magento database. Browser acceptance still runs the real forms.
namespace Magento\Framework\App\Action { interface HttpGetActionInterface {} }
namespace Magento\Framework\App\Config {
    interface ScopeConfigInterface {
        public function getValue($path = null, $scope = 'default', $code = null);
        public function isSetFlag($path, $scope = 'default', $code = null);
    }
}
namespace Magento\Framework\App { interface RequestInterface { public function getParam($name, $default = null); } }
namespace Magento\Store\Model { interface StoreManagerInterface {} }
namespace Magento\Framework\Controller\Result {
    class Raw {
        public array $headers = [];
        public string $contents = '';
        public function setHeader($name, $value, $replace) { $this->headers[$name] = $value; return $this; }
        public function setContents($contents) { $this->contents = $contents; return $this; }
    }
    class RawFactory { public function create() { return new Raw; } }
    class Json {
        public array $data = [];
        public function setData($data) { $this->data = $data; return $this; }
    }
    class JsonFactory { public function create() { return new Json; } }
}
namespace {
    require __DIR__ . '/../src/app/code/Application/Blog/Test/Configuration/fixtures/Controller/Index/Configuration.php';
    $request = new class implements \Magento\Framework\App\RequestInterface {
        public string $scenario = 'warmup-only';
        public function getParam($name, $default = null) { return $name === 'case' ? $this->scenario : $default; }
    };
    $config = new class implements \Magento\Framework\App\Config\ScopeConfigInterface {
        public array $reads = [];
        public function getValue($path = null, $scope = 'default', $code = null) {
            $this->reads[] = $path;
            return str_ends_with($path, '/unused') ? '<img src=x onerror="alert(1)">' : 'Journal';
        }
        public function isSetFlag($path, $scope = 'default', $code = null) { return false; }
    };
    $stores = new class implements \Magento\Store\Model\StoreManagerInterface {};
    $controller = new \Application\Blog\Controller\Index\Configuration($config, $request,
        new \Magento\Framework\Controller\Result\JsonFactory, new \Magento\Framework\Controller\Result\RawFactory, $stores);
    $response = $controller->execute();
    if (!$response instanceof \Magento\Framework\Controller\Result\Raw
        || $response->headers['Content-Type'] !== 'text/html; charset=UTF-8'
        || $response->headers['Cache-Control'] !== 'no-store'
        || !str_contains($response->contents, '<html lang="en">')
        || !str_contains($response->contents, '&lt;img src=x')
        || str_contains($response->contents, '<img')
        || $config->reads !== ['application_blog/display/unused']) {
        throw new \RuntimeException('Warm-up must render escaped HTML while consuming only its fixture setting');
    }
    $request->scenario = 'default-read';
    $response = $controller->execute();
    if (!$response instanceof \Magento\Framework\Controller\Result\Json || $response->data !== ['heading' => 'Journal']) {
        throw new \RuntimeException('Config-read acceptance endpoints must retain their JSON responses');
    }
    echo "Configuration fixture warm-up HTML, escaping and JSON responses passed.\n";
}
