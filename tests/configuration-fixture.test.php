<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);

// Small result/config doubles exercise the real isolated controller without
// requiring a Magento database. Browser acceptance still runs the real forms.
namespace Magento\Framework {
    class DataObject {
        public function __construct(private array $data) {}
        public function getData() { return $this->data; }
    }
}
namespace Magento\Framework\Event { interface ManagerInterface { public function dispatch($eventName, array $data = []); } }
namespace Magento\Framework\App\Action { interface HttpGetActionInterface {} }
namespace Magento\Framework\App\Config {
    interface ScopeConfigInterface {
        public function getValue($path = null, $scope = 'default', $code = null);
        public function isSetFlag($path, $scope = 'default', $code = null);
    }
}
namespace Magento\Framework\App {
    interface RequestInterface { public function getParam($name, $default = null); }
    class ObjectManager {
        public static array $requests = [];
        public static function getInstance(): self { return new self; }
        public function get(string $type): object {
            self::$requests[] = $type;
            return match ($type) {
                'Application\Blog\Model\JournalWarmPreference' => new \Application\Blog\Model\JournalPreferenceProbe(),
                default => throw new \LogicException("Unexpected fixture preference $type"),
            };
        }
    }
}
namespace Magento\Store\Model { interface StoreManagerInterface {} }
namespace Magento\Backend\App { interface ConfigInterface {} }
namespace Magento\Framework\Controller\Result {
    class Raw {
        public array $headers = [];
        public string $contents = '';
        public function setHeader($name, $value, $replace) { $this->headers[$name] = $value; return $this; }
        public function setContents($contents) { $this->contents = $contents; return $this; }
    }
    class RawFactory { public function create() { return new Raw; } }
    class Json {
        public object $data;
        public function setData($data) { $this->data = $data; return $this; }
    }
    class JsonFactory { public function create() { return new Json; } }
}
namespace {
    $fixtures = __DIR__ . '/../src/app/code/Application/Blog/Test/Configuration/fixtures';
    require $fixtures . '/Model/JournalPluginSubjectInterface.php';
    require $fixtures . '/Model/JournalPluginSubject.php';
    require $fixtures . '/Model/JournalPreferenceProbe.php';
    require $fixtures . '/Controller/Index/Configuration.php';
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
    $backend = new class implements \Magento\Backend\App\ConfigInterface {
        public function getValue($path) { return 'Backend journal'; }
        public function isSetFlag($path) { return true; }
    };
    $events = new class implements \Magento\Framework\Event\ManagerInterface {
        public array $names = [];
        public function dispatch($eventName, array $data = []) { $this->names[] = $eventName; }
    };
    $pluginSubject = new class extends \Application\Blog\Model\JournalPluginSubject {
        public int $warmups = 0;
        public function warm(): string { $this->warmups++; return 'warm-plugin'; }
    };
    $controller = new \Application\Blog\Controller\Index\Configuration($config, $request,
        new \Magento\Framework\Controller\Result\JsonFactory, new \Magento\Framework\Controller\Result\RawFactory, $stores, $backend, $events, $pluginSubject);
    $response = $controller->execute();
    if (!$response instanceof \Magento\Framework\Controller\Result\Raw
        || $response->headers['Content-Type'] !== 'text/html; charset=UTF-8'
        || $response->headers['Cache-Control'] !== 'no-store'
        || !str_contains($response->contents, '<html lang="en">')
        || !str_contains($response->contents, '&lt;img src=x')
        || str_contains($response->contents, '<img')
        || \Magento\Framework\App\ObjectManager::$requests !== ['Application\Blog\Model\JournalWarmPreference']
        || $pluginSubject->warmups !== 1
        || $events->names !== ['magelens_journal_warmup']
        || $config->reads !== ['application_blog/display/unused']) {
        throw new \RuntimeException('Warm-up must render escaped HTML while consuming only its fixture setting');
    }
    $request->scenario = 'default-read';
    $response = $controller->execute();
    if (!$response instanceof \Magento\Framework\Controller\Result\Json || (array) $response->data !== ['heading' => 'Journal']) {
        throw new \RuntimeException('Config-read acceptance endpoints must retain their JSON responses');
    }
    $request->scenario = 'baseline';
    $response = $controller->execute();
    if (json_encode($response->data, JSON_THROW_ON_ERROR) !== '{}') {
        throw new \RuntimeException('The baseline response must be a JSON object for both browser runners');
    }
    $request->scenario = 'backend-reads';
    if ((array) $controller->execute()->data !== ['heading' => 'Backend journal', 'enabled' => true]) {
        throw new \RuntimeException('Backend value and flag fixture must exercise the Backend accessor');
    }
    echo "Configuration fixture warm-up HTML, escaping and JSON responses passed.\n";
}
