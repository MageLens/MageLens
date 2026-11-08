<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
if (getenv('MAGELENS_PERFORMANCE_DISPOSABLE') !== '1') throw new RuntimeException('Dedicated disposable installation required');
require '/var/www/html/app/bootstrap.php';
$bootstrap = \Magento\Framework\App\Bootstrap::create(BP, $_SERVER);
$om = $bootstrap->getObjectManager();
$om->get(\Magento\Framework\App\State::class)->setAreaCode('adminhtml');
$store = $om->get(\Magento\Store\Model\StoreManagerInterface::class)->getStore();
$websiteId = (int)$store->getWebsiteId();
$resource = $om->get(\Magento\Framework\App\ResourceConnection::class);
$themeId = $resource->getConnection()->fetchOne('SELECT theme_id FROM ' . $resource->getTableName('theme') . ' WHERE theme_path = ?', ['Magento/luma']);
if (!$themeId) throw new RuntimeException('Install the Luma theme before preparing the performance fixture');
if ((int)$om->get(\Magento\Framework\App\Config\ScopeConfigInterface::class)->getValue('design/theme/theme_id') !== (int)$themeId)
    throw new RuntimeException('Configure the installation as Luma before preparing this fixture');
$config = [
    'system/smtp/disable' => '1', 'sales_email/order/enabled' => '0',
    'customer/create_account/confirm' => '0', 'customer/captcha/enable' => '0',
    'currency/options/base' => 'USD', 'currency/options/default' => 'USD', 'currency/options/allow' => 'USD',
    'carriers/flatrate/active' => '1', 'carriers/flatrate/price' => '5', 'carriers/flatrate/type' => 'O',
    'carriers/flatrate/handling_fee' => '0', 'carriers/flatrate/sallowspecific' => '0',
    'payment/checkmo/active' => '1', 'payment/free/active' => '1',
    'catalog/seo/product_url_suffix' => '.html', 'tax/calculation/price_includes_tax' => '0',
    'checkout/cart/number_items_to_display_pager' => '100', 'sales/orders/items_per_page' => '100',
];
$writer = $om->get(\Magento\Framework\App\Config\Storage\WriterInterface::class);
foreach ($config as $key => $value) $writer->save($key, $value);
$customers = $om->get(\Magento\Customer\Api\CustomerRepositoryInterface::class);
$email = 'magelens.performance@example.test';
try { $customer = $customers->get($email, $websiteId); }
catch (\Magento\Framework\Exception\NoSuchEntityException $error) {
    $customer = $om->get(\Magento\Customer\Api\Data\CustomerInterfaceFactory::class)->create();
    $customer->setWebsiteId($websiteId)->setStoreId((int)$store->getId())->setEmail($email)
        ->setFirstname('MageLens')->setLastname('Performance')->setGroupId(1)->setConfirmation(null);
}
$hash = $om->get(\Magento\Framework\Encryption\EncryptorInterface::class)->getHash('MageLens-Performance-Only-42!', true);
$customer = $customers->save($customer, $hash);
$addresses = $om->get(\Magento\Customer\Api\AddressRepositoryInterface::class);
$address = $customer->getDefaultShipping() ? $addresses->getById((int)$customer->getDefaultShipping()) :
    $om->get(\Magento\Customer\Api\Data\AddressInterfaceFactory::class)->create();
$region = $om->get(\Magento\Customer\Api\Data\RegionInterfaceFactory::class)->create();
$region->setRegionId(12)->setRegionCode('CA')->setRegion('California');
$address->setCustomerId((int)$customer->getId())->setFirstname('MageLens')->setLastname('Performance')
    ->setCountryId('US')->setRegion($region)->setRegionId(12)->setCity('Beverly Hills')->setPostcode('90210')
    ->setStreet(['100 Test Avenue'])->setTelephone('5550100042')->setIsDefaultShipping(true)->setIsDefaultBilling(true);
$addresses->save($address);
$products = $om->get(\Magento\Catalog\Api\ProductRepositoryInterface::class);
$attributeSet = (int)$om->get(\Magento\Eav\Model\Config::class)->getEntityType('catalog_product')->getDefaultAttributeSetId();
for ($i = 1; $i <= 80; $i++) {
    $sku = 'MLPERF-' . str_pad((string)$i, 3, '0', STR_PAD_LEFT);
    try { $product = $products->get($sku, false, 0, true); }
    catch (\Magento\Framework\Exception\NoSuchEntityException $error) { $product = $om->get(\Magento\Catalog\Model\ProductFactory::class)->create(); }
    $product->setStoreId(0)->setSku($sku)->setName('MageLens performance product ' . $i)->setTypeId('simple')
        ->setAttributeSetId($attributeSet)->setStatus(1)->setVisibility(4)->setPrice(10 + $i % 7)->setTaxClassId(0)
        ->setWeight(1)->setWebsiteIds([$websiteId])->setUrlKey('magelens-performance-' . $i)
        ->setStockData(['use_config_manage_stock'=>0,'manage_stock'=>1,'is_in_stock'=>1,'qty'=>100000]);
    $products->save($product);
}
foreach ([5,10,15,20,25,30,100] as $discount) {
    $code = 'MLPERF-' . $discount;
    $coupon = $om->get(\Magento\SalesRule\Model\CouponFactory::class)->create()->load($code, 'code');
    $rule = $om->get(\Magento\SalesRule\Model\RuleFactory::class)->create();
    if ($coupon->getRuleId()) $rule->load((int)$coupon->getRuleId());
    $rule->setName('MageLens performance ' . $discount)->setWebsiteIds([$websiteId])->setCustomerGroupIds([1])
        ->setIsActive(1)->setCouponType(2)->setCouponCode($code)->setUsesPerCoupon(0)->setUsesPerCustomer(0)
        ->setSimpleAction('by_percent')->setDiscountAmount($discount)->setApplyToShipping(1)
        ->setStopRulesProcessing(1)->setIsAdvanced(1)->setSortOrder(0);
    $rule->save();
}
echo json_encode(['fixture'=>'magelens-performance-v1','products'=>80,'customer'=>$email,'coupons'=>7], JSON_THROW_ON_ERROR) . "\n";
