<?php
declare(strict_types=1);

function localFrontendThemes(array $registered, array $roots, string $basePath): array
{
    $themes = [];
    foreach ($registered as $name => $directory) {
        // Blank and Luma are also under app/design in Magento source archives.
        if (!str_starts_with($name, 'frontend/')
            || in_array($name, ['frontend/Magento/blank', 'frontend/Magento/luma'], true)
            || !str_starts_with($directory, $basePath . '/app/design/frontend/')
        ) continue;
        foreach ($roots as $root) {
            $sourceDirectory = $basePath . '/' . trim($root, '/');
            if ($directory === $sourceDirectory || str_starts_with($directory, $sourceDirectory . '/')) {
                $themes[] = substr($name, strlen('frontend/'));
                break;
            }
        }
    }
    sort($themes);
    return $themes;
}

function configureProjectTheme(Magento\Framework\ObjectManagerInterface $om, array $roots): void
{
    $om->get(Magento\Theme\Model\Theme\Registration::class)->register();
    $path = 'design/theme/theme_id';
    $config = $om->get(Magento\Framework\App\Config\ScopeConfigInterface::class);
    $stores = $om->get(Magento\Store\Model\StoreManagerInterface::class);
    $scopes = [['default', null]];
    foreach ($stores->getWebsites() as $website) $scopes[] = ['websites', $website->getCode()];
    foreach ($stores->getStores() as $store) $scopes[] = ['stores', $store->getCode()];
    // Read effective configuration so database, config.php, env.php and environment
    // selections at every scope take precedence over installer defaults.
    foreach ($scopes as [$scope, $code]) {
        if ($config->getValue($path, $scope, $code)) {
            echo "Preserved configured storefront theme.\n";
            return;
        }
    }
    $registrar = $om->get(Magento\Framework\Component\ComponentRegistrar::class);
    $themes = localFrontendThemes($registrar->getPaths(Magento\Framework\Component\ComponentRegistrar::THEME), $roots, BP);
    if (!$themes) {
        echo "No local storefront theme to select.\n";
        return;
    }
    if (count($themes) > 1) {
        echo 'Multiple local storefront themes (', implode(', ', $themes), "). Select one in Content > Design > Configuration.\n";
        return;
    }
    $theme = $om->create(Magento\Theme\Model\ResourceModel\Theme\Collection::class)
        ->addFieldToFilter('area', 'frontend')
        ->addFieldToFilter('type', Magento\Framework\View\Design\ThemeInterface::TYPE_PHYSICAL)
        ->addFieldToFilter('theme_path', $themes[0])->getFirstItem();
    if (!$theme->getId()) throw new RuntimeException('Local storefront theme was not registered: ' . $themes[0]);
    $om->get(Magento\Framework\App\Config\Storage\WriterInterface::class)->save($path, $theme->getId());
    $om->get(Magento\Framework\App\Cache\TypeListInterface::class)->cleanType('config');
    $om->get(Magento\Framework\App\Config\ReinitableConfigInterface::class)->reinit();
    echo 'Enabled custom theme ', $themes[0], "\n";
}

if (realpath($_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    require '/var/www/html/app/bootstrap.php';
    require __DIR__ . '/project.php';
    $om = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
    $om->get(Magento\Framework\App\State::class)->setAreaCode('adminhtml');
    $profile = getenv('MAGELENS_THEME');
    if (in_array($profile, ['luma', 'hyva'], true)) {
        $themePath = ['hyva' => 'Hyva/default-csp', 'luma' => 'Magento/luma'][$profile];
        $om->get(Magento\Theme\Model\Theme\Registration::class)->register();
        $theme = $om->create(Magento\Theme\Model\ResourceModel\Theme\Collection::class)
            ->addFieldToFilter('area', 'frontend')->addFieldToFilter('theme_path', $themePath)->getFirstItem();
        if (!$theme->getId()) throw new RuntimeException('Selected theme is not registered: ' . $themePath);
        $writer = $om->get(Magento\Framework\App\Config\Storage\WriterInterface::class);
        $writer->save('design/theme/theme_id', $theme->getId());
        if ($profile === 'hyva') {
            foreach (['customer/captcha/enable', 'dev/template/minify_html', 'dev/js/merge_files', 'dev/js/enable_js_bundling',
                'dev/js/minify_files', 'dev/js/move_script_to_bottom', 'dev/css/merge_css_files', 'dev/css/minify_files'] as $setting) {
                $writer->save($setting, 0);
            }
        }
        // The CSP storefront enforces script policy. The bundled Luma checkout
        // remains a separate legacy route; licensed Hyva Checkout is not installed.
        $writer->save('csp/mode/storefront/report_only', $profile === 'hyva' ? 0 : 1);
        $writer->save('csp/policies/storefront/scripts/eval', $profile === 'hyva' ? 0 : 1);
        $writer->save('csp/policies/storefront/scripts/inline', $profile === 'hyva' ? 0 : 1);
        $writer->save('csp/policies/storefront_checkout_index_index/scripts/eval', 1);
        $writer->save('csp/policies/storefront_checkout_index_index/scripts/inline', 1);
        $om->get(Magento\Framework\App\Cache\TypeListInterface::class)->cleanType('config');
        echo 'Enabled ', $themePath, "\n";
    } else {
        configureProjectTheme($om, project()['roots']);
    }
}
