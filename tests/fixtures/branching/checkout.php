<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
// Synthetic setup and read-only assertions; orders are placed through Luma UI.
require '/var/www/html/app/bootstrap.php';
$om = Magento\Framework\App\Bootstrap::create(BP, $_SERVER)->getObjectManager();
$om->get(Magento\Framework\App\State::class)->setAreaCode('adminhtml');
$resource = $om->get(Magento\Framework\App\ResourceConnection::class);
$db = $resource->getConnection();
$email = 'checkout-probe@example.test';
$groupCode = 'Branch checkout group';
$skus = ['checkout-simple', 'checkout-configurable', 'checkout-small', 'checkout-large',
    'checkout-bundle', 'checkout-component-a', 'checkout-component-b'];
function table(string $name): string { global $resource; return $resource->getTableName($name); }
function emit(array $value): void { echo json_encode($value, JSON_THROW_ON_ERROR), "\n"; }
function cents($value): int { return (int) round((float) $value * 100); }
function pendingQueues(): array {
    global $db;
    $rows = $db->fetchAll($db->select()->from(['s' => table('queue_message_status')], ['status', 'count' => 'COUNT(*)'])
        ->join(['q' => table('queue')], 'q.id = s.queue_id', ['name'])->where('s.status NOT IN (?)', [4, 7])
        ->group(['q.name', 's.status'])->order(['q.name', 's.status']));
    return array_map(static fn($r) => ['name' => $r['name'], 'status' => (int) $r['status'], 'count' => (int) $r['count']], $rows);
}
function addressState(array $row): array {
    $keys = ['firstname', 'lastname', 'street', 'city', 'region', 'postcode', 'country_id', 'telephone'];
    return array_combine($keys, array_map(static fn($k) => (string) ($row[$k] ?? ''), $keys));
}
function lineState(string $tableName, string $foreignKey, int $id, bool $order): array {
    global $db;
    $rows = $db->fetchAll($db->select()->from(table($tableName))->where($foreignKey . ' = ?', $id)->order('item_id'));
    $products = $db->fetchPairs($db->select()->from(table('catalog_product_entity'), ['entity_id', 'sku']));
    $byId = [];
    foreach ($rows as $r) $byId[$r['item_id']] = $products[$r['product_id']] ?? null;
    $out = [];
    foreach ($rows as $r) {
        $options = $order && $r['product_options'] ? json_decode($r['product_options'], true, 512, JSON_THROW_ON_ERROR) : [];
        $attributes = array_map(static fn($a) => ['label' => $a['label'], 'value' => $a['value']], $options['attributes_info'] ?? []);
        $bundle = [];
        foreach ($options['bundle_options'] ?? [] as $a) {
            $bundle[] = ['label' => $a['label'], 'value' => array_map(static fn($v) =>
                ['title' => $v['title'], 'qty' => (float) $v['qty'], 'price' => cents($v['price'])], $a['value'])];
        }
        usort($bundle, static fn($a, $b) => strcmp($a['label'], $b['label']));
        $out[] = ['productSku' => $products[$r['product_id']] ?? null, 'sku' => $r['sku'], 'type' => $r['product_type'],
            'parentSku' => $r['parent_item_id'] ? $byId[$r['parent_item_id']] : null,
            'qty' => (float) $r[$order ? 'qty_ordered' : 'qty'], 'price' => cents($r['price']),
            'rowTotal' => cents($r['row_total']), 'discount' => cents($r['discount_amount']), 'tax' => cents($r['tax_amount']),
            'attributes' => $attributes, 'bundleOptions' => $bundle];
    }
    usort($out, static fn($a, $b) => strcmp($a['productSku'], $b['productSku']));
    return $out;
}
function moneyState(array $row): array {
    $fields = ['subtotal', 'grand_total', 'discount_amount', 'shipping_amount', 'shipping_discount_amount', 'tax_amount'];
    return array_combine($fields, array_map(static fn($k) => cents($row[$k] ?? 0), $fields));
}
function snapshot(): array {
    global $db, $email, $skus;
    $customer = $db->fetchRow($db->select()->from(['c' => table('customer_entity')])
        ->join(['g' => table('customer_group')], 'c.group_id = g.customer_group_id', ['customer_group_code'])->where('c.email = ?', $email));
    if (!$customer) throw new RuntimeException('Missing checkout customer');
    $customerId = (int) $customer['entity_id'];
    $addresses = $db->fetchAll($db->select()->from(table('customer_address_entity'))->where('parent_id = ?', $customerId)->order('entity_id'));
    $saved = array_map(static fn($a) => ['address' => addressState($a),
        'defaultShipping' => (int) $a['entity_id'] === (int) $customer['default_shipping'],
        'defaultBilling' => (int) $a['entity_id'] === (int) $customer['default_billing']], $addresses);
    $quotes = $db->fetchAll($db->select()->from(table('quote'))->where('customer_id = ?', $customerId)->where('is_active = ?', 1));
    if (count($quotes) > 1) throw new RuntimeException('Multiple active checkout quotes');
    $quote = $quotes[0] ?? null; $shipping = null; $quoteAddress = null;
    if ($quote) {
        $row = $db->fetchRow($db->select()->from(table('quote_address'))->where('quote_id = ?', $quote['entity_id'])->where('address_type = ?', 'shipping'));
        $shipping = ($row['shipping_method'] ?? '') ?: null;
        $quoteAddress = $row && $row['country_id'] ? addressState($row) : null;
    }
    $orders = [];
    foreach ($db->fetchAll($db->select()->from(table('sales_order'))->where('customer_email = ?', $email)->order('entity_id')) as $o) {
        $orderId = (int) $o['entity_id'];
        $addresses = $db->fetchAll($db->select()->from(table('sales_order_address'))->where('parent_id = ?', $orderId)->order('address_type'));
        $addressMap = [];
        foreach ($addresses as $a) $addressMap[$a['address_type']] = addressState($a);
        $orders[] = ['customer' => $o['customer_email'], 'group' => (int) $o['customer_group_id'] === (int) $customer['group_id'] ? $customer['customer_group_code'] : 'WRONG_GROUP',
            'state' => $o['state'], 'status' => $o['status'], 'currency' => $o['order_currency_code'],
            'coupon' => ($o['coupon_code'] ?? '') ?: null, 'shipping' => $o['shipping_method'],
            'money' => moneyState($o), 'totalDue' => cents($o['total_due']), 'totalPaid' => cents($o['total_paid']),
            'payment' => $db->fetchOne($db->select()->from(table('sales_order_payment'), ['method'])->where('parent_id = ?', $orderId)),
            'items' => lineState('sales_order_item', 'order_id', $orderId, true), 'addresses' => $addressMap,
            'invoices' => (int) $db->fetchOne($db->select()->from(table('sales_invoice'), ['COUNT(*)'])->where('order_id = ?', $orderId)),
            'shipments' => (int) $db->fetchOne($db->select()->from(table('sales_shipment'), ['COUNT(*)'])->where('order_id = ?', $orderId)),
            'transactions' => (int) $db->fetchOne($db->select()->from(table('sales_payment_transaction'), ['COUNT(*)'])->where('order_id = ?', $orderId))];
    }
    $stock = $db->fetchAll($db->select()->from(table('inventory_source_item'), ['source_code', 'sku', 'quantity', 'status'])->where('sku IN (?)', $skus)->order(['sku', 'source_code']));
    $reservations = $db->fetchAll($db->select()->from(table('inventory_reservation'), ['sku', 'quantity' => 'SUM(quantity)'])->where('sku IN (?)', $skus)->group('sku')->order('sku'));
    $coupons = [];
    foreach (['CHECKOUT10', 'CHECKOUTFREE'] as $code) {
        $r = $db->fetchRow($db->select()->from(['c' => table('salesrule_coupon')], ['coupon_id', 'rule_id', 'times_used'])
            ->join(['r' => table('salesrule')], 'r.rule_id = c.rule_id', ['rule_used' => 'times_used'])->where('c.code = ?', $code));
        if (!$r) throw new RuntimeException('Missing fixture coupon');
        $used = $db->fetchOne($db->select()->from(table('salesrule_coupon_usage'), ['times_used'])->where('coupon_id = ?', $r['coupon_id'])->where('customer_id = ?', $customerId));
        $coupons[$code] = ['coupon' => (int) $r['times_used'], 'rule' => (int) $r['rule_used'], 'customer' => (int) $used];
    }
    return ['customer' => $email, 'group' => $customer['customer_group_code'], 'savedAddresses' => $saved,
        'items' => $quote ? lineState('quote_item', 'quote_id', (int) $quote['entity_id'], false) : [],
        'quote' => $quote ? ['coupon' => ($quote['coupon_code'] ?? '') ?: null, 'shipping' => $shipping,
            'address' => $quoteAddress, 'money' => moneyState($quote), 'groupMatches' => (int) $quote['customer_group_id'] === (int) $customer['group_id']] : null,
        'orders' => $orders,
        'sourceStock' => array_map(static fn($r) => ['sku' => $r['sku'], 'source' => $r['source_code'], 'qty' => (float) $r['quantity'], 'status' => (int) $r['status']], $stock),
        'reservations' => array_map(static fn($r) => ['sku' => $r['sku'], 'qty' => (float) $r['quantity']], $reservations),
        'coupons' => $coupons, 'pendingQueues' => pendingQueues()];
}
$action = $argv[1] ?? '';
$data = isset($argv[2]) ? json_decode($argv[2], true, 512, JSON_THROW_ON_ERROR) : [];
if ($action === 'preflight') {
    foreach ([['customer_entity', 'email', [$email]], ['catalog_product_entity', 'sku', $skus],
        ['salesrule_coupon', 'code', ['CHECKOUT10', 'CHECKOUTFREE']], ['customer_group', 'customer_group_code', [$groupCode]],
        ['eav_attribute', 'attribute_code', ['checkout_size']]] as [$name, $column, $values]) {
        if ($db->fetchOne($db->select()->from(table($name), ['COUNT(*)'])->where($column . ' IN (?)', $values))) {
            throw new RuntimeException('Existing checkout fixture: ' . $name);
        }
    }
    if ($db->fetchOne($db->select()->from(table('sales_order'), ['COUNT(*)']))) throw new RuntimeException('Checkout benchmark requires an isolated installation without orders');
    emit([]);
} elseif ($action === 'prepare') {
    $metadata = $om->get(Magento\Framework\App\ProductMetadataInterface::class);
    if ($metadata->getDistributionName() !== 'Mage-OS' || $metadata->getDistributionVersion() !== '4.0.0') throw new RuntimeException('Expected Mage-OS 4.0.0');
    $writer = $om->get(Magento\Framework\App\Config\Storage\WriterInterface::class);
    foreach (['carriers/flatrate/active' => 1, 'carriers/flatrate/price' => 5, 'carriers/flatrate/type' => 'O',
        'carriers/freeshipping/active' => 0, 'sales_email/general/async_sending' => 0, 'system/smtp/disable' => 1,
        'customer/create_account/confirm' => 0, 'payment/checkmo/active' => 1, 'payment/checkmo/order_status' => 'pending',
        'payment/free/active' => 1, 'payment/free/order_status' => 'pending', 'currency/options/base' => 'USD',
        'currency/options/default' => 'USD', 'currency/options/allow' => 'USD', 'tax/calculation/price_includes_tax' => 0] as $key => $value) $writer->save($key, $value);
    $om->get(Magento\Framework\App\Cache\Manager::class)->flush(['config']);
    $taxClass = $db->fetchOne($db->select()->from(table('tax_class'), ['class_id'])->where('class_type = ?', 'CUSTOMER')->where('class_name = ?', 'Retail Customer'));
    if (!$taxClass) throw new RuntimeException('Missing retail customer tax class');
    $group = $om->create(Magento\Customer\Api\Data\GroupInterface::class)->setCode($groupCode)->setTaxClassId((int) $taxClass);
    $group = $om->get(Magento\Customer\Api\GroupRepositoryInterface::class)->save($group);
    $customer = $om->create(Magento\Customer\Api\Data\CustomerInterface::class);
    $customer->setWebsiteId(1)->setStoreId(1)->setEmail($email)->setFirstname('Checkout')->setLastname('Probe')->setGroupId($group->getId());
    $customer = $om->get(Magento\Customer\Api\AccountManagementInterface::class)->createAccount($customer, 'CheckoutProbe9!');
    $regionId = $db->fetchOne($db->select()->from(table('directory_country_region'), ['region_id'])->where('country_id = ?', 'US')->where('code = ?', 'CA'));
    if (!$regionId) throw new RuntimeException('Missing California region');
    $address = $om->create(Magento\Customer\Api\Data\AddressInterface::class);
    $region = $om->create(Magento\Customer\Api\Data\RegionInterface::class)->setRegionId((int) $regionId)->setRegionCode('CA')->setRegion('California');
    $address->setCustomerId($customer->getId())->setFirstname('Checkout')->setLastname('Probe')->setStreet(['123 Test Street'])
        ->setCity('Los Angeles')->setRegion($region)->setRegionId((int) $regionId)->setCountryId('US')->setPostcode('90001')->setTelephone('2025550123')
        ->setIsDefaultShipping(true)->setIsDefaultBilling(true);
    $address = $om->get(Magento\Customer\Api\AddressRepositoryInterface::class)->save($address);
    $eav = $om->get(Magento\Eav\Setup\EavSetup::class);
    $attributeSet = (int) $eav->getAttributeSetId(Magento\Catalog\Model\Product::ENTITY, 'Default');
    $attribute = $om->create(Magento\Catalog\Api\Data\ProductAttributeInterface::class);
    $attribute->setData(['attribute_code' => 'checkout_size', 'entity_type_id' => $eav->getEntityTypeId('catalog_product'),
        'is_global' => 1, 'is_user_defined' => 1, 'frontend_input' => 'select', 'frontend_label' => ['Checkout size'],
        'backend_type' => 'int', 'is_required' => 0, 'is_visible' => 1,
        'option' => ['value' => ['small' => ['Small'], 'large' => ['Large']], 'order' => ['small' => 1, 'large' => 2]]]);
    $attribute = $om->get(Magento\Catalog\Api\ProductAttributeRepositoryInterface::class)->save($attribute);
    $eav->addAttributeToGroup('catalog_product', $attributeSet, $eav->getDefaultAttributeGroupId('catalog_product', $attributeSet), $attribute->getId());
    $om->get(Magento\Eav\Model\Config::class)->clear();
    $attribute = $om->get(Magento\Catalog\Api\ProductAttributeRepositoryInterface::class)->get('checkout_size');
    $options = [];
    foreach ($attribute->getOptions() as $option) if ($option->getValue()) $options[$option->getLabel()] = (int) $option->getValue();
    if (!isset($options['Small'], $options['Large'])) throw new RuntimeException('Configurable size options missing');
    $repository = $om->get(Magento\Catalog\Api\ProductRepositoryInterface::class);
    $products = [];
    foreach ([['simple', 'simple', 20, null], ['configurable', 'configurable', 0, null],
        ['small', 'simple', 30, 'Small'], ['large', 'simple', 35, 'Large'],
        ['bundle', 'bundle', 0, null], ['component-a', 'simple', 12.5, null], ['component-b', 'simple', 7.5, null]] as [$suffix, $type, $price, $size]) {
        $p = $om->create(Magento\Catalog\Model\Product::class);
        $p->setSku('checkout-' . $suffix)->setName('Checkout ' . $suffix)->setTypeId($type)->setAttributeSetId($attributeSet)
            ->setPrice($price)->setWeight(1)->setStatus(1)->setVisibility(in_array($suffix, ['simple', 'configurable', 'bundle'], true) ? 4 : 1)
            ->setWebsiteIds([1])->setTaxClassId(0)->setStockData(['use_config_manage_stock' => 0, 'manage_stock' => 1, 'is_in_stock' => 1, 'qty' => 1000]);
        if ($size) $p->setData('checkout_size', $options[$size]);
        if ($type === 'bundle') $p->setPriceType(0)->setSkuType(0)->setWeightType(0)->setShipmentType(0)->setPriceView(0);
        $products[$suffix] = $repository->save($p);
    }
    $values = [];
    foreach ($options as $id) $values[] = $om->create(Magento\ConfigurableProduct\Api\Data\OptionValueInterface::class)->setValueIndex($id);
    $option = $om->create(Magento\ConfigurableProduct\Api\Data\OptionInterface::class)->setAttributeId($attribute->getId())
        ->setLabel('Checkout size')->setPosition(0)->setIsUseDefault(true)->setValues($values);
    $om->get(Magento\ConfigurableProduct\Api\OptionRepositoryInterface::class)->save('checkout-configurable', $option);
    foreach (['checkout-small', 'checkout-large'] as $sku) $om->get(Magento\ConfigurableProduct\Api\LinkManagementInterface::class)->addChild('checkout-configurable', $sku);
    $bundleOptions = [];
    foreach (['component-a', 'component-b'] as $position => $suffix) {
        $links = [];
        foreach (['component-a', 'component-b'] as $choice => $component) {
            $links[] = $om->create(Magento\Bundle\Api\Data\LinkInterface::class)->setSku('checkout-' . $component)->setQty(1)
                ->setPosition($choice)->setIsDefault(false)->setPrice(0)->setPriceType(0)->setCanChangeQuantity(0);
        }
        $option = $om->create(Magento\Bundle\Api\Data\OptionInterface::class)->setTitle('Checkout ' . $suffix)
            ->setRequired(true)->setType('select')->setPosition($position)->setSku('checkout-bundle')->setProductLinks($links);
        $id = $om->get(Magento\Bundle\Api\ProductOptionRepositoryInterface::class)->save($products['bundle'], $option);
        $saved = $om->get(Magento\Bundle\Api\ProductOptionRepositoryInterface::class)->get('checkout-bundle', $id);
        $links = $saved->getProductLinks();
        if (count($links) !== 2) throw new RuntimeException('Unexpected bundle selection count');
        $chosen = array_values(array_filter($links, static fn($link) => $link->getSku() === 'checkout-' . $suffix));
        if (count($chosen) !== 1) throw new RuntimeException('Missing bundle selection');
        $bundleOptions[] = ['id' => (int) $id, 'selectionId' => (int) $chosen[0]->getId(), 'label' => 'Checkout ' . $suffix, 'sku' => 'checkout-' . $suffix];
    }
    foreach (['CHECKOUT10' => 10, 'CHECKOUTFREE' => 100] as $code => $discount) {
        $rule = $om->create(Magento\SalesRule\Model\Rule::class);
        $rule->setName('Branch checkout ' . $code)->setIsActive(1)->setWebsiteIds([1])->setCustomerGroupIds([$group->getId()])
            ->setCouponType(Magento\SalesRule\Model\Rule::COUPON_TYPE_SPECIFIC)->setCouponCode($code)->setSimpleAction('by_percent')
            ->setDiscountAmount($discount)->setApplyToShipping($discount === 100)->setStopRulesProcessing(1)->setUsesPerCustomer(1)->setUsesPerCoupon(1);
        $rule->save();
    }
    emit(['version' => $metadata->getDistributionVersion(), 'magentoVersion' => $metadata->getVersion(),
        'customer' => $email, 'group' => $groupCode, 'addressId' => (int) $address->getId(),
        'products' => ['simple' => ['id' => (int) $products['simple']->getId()],
            'configurable' => ['id' => (int) $products['configurable']->getId(), 'attributeId' => (int) $attribute->getId(), 'valueId' => $options['Large']],
            'bundle' => ['id' => (int) $products['bundle']->getId(), 'options' => $bundleOptions]]]);
} elseif ($action === 'queues') {
    emit(pendingQueues());
} elseif ($action === 'state') {
    emit(snapshot());
} elseif ($action === 'allocate-order') {
    $value = $data['value'] ?? null;
    if (!is_int($value) || $value < 1000000000 || $value >= 2000000000) throw new RuntimeException('Invalid external order allocation');
    $quotes = $db->fetchAll($db->select()->from(table('quote'), ['entity_id', 'reserved_order_id'])->where('customer_email = ?', $email)->where('is_active = ?', 1));
    if (count($quotes) !== 1 || $quotes[0]['reserved_order_id']) throw new RuntimeException('Expected one unreserved active checkout quote');
    if ($db->fetchOne($db->select()->from(table('sales_order'), ['COUNT(*)']))) throw new RuntimeException('Sibling order leaked before placement');
    foreach (['sequence_order_1', 'sales_order'] as $name) {
        $db->query('ALTER TABLE ' . $db->quoteIdentifier(table($name)) . ' AUTO_INCREMENT = ' . $value);
    }
    emit(['allocated' => $value]);
} elseif ($action === 'order-evidence') {
    $rows = $db->fetchAll($db->select()->from(table('sales_order'), ['entity_id', 'increment_id', 'quote_id', 'customer_email'])->where('customer_email = ?', $email)->order('entity_id'));
    emit($rows);
} elseif ($action === 'cleanup') {
    // Teardown after failed initialization only; never delete completed orders.
    if ($db->fetchOne($db->select()->from(table('sales_order'), ['COUNT(*)'])->where('customer_email = ?', $email))) throw new RuntimeException('Retain checkout orders for investigation');
    $om->get(Magento\Framework\Registry::class)->register('isSecureArea', true);
    try { $om->get(Magento\Customer\Api\CustomerRepositoryInterface::class)->deleteById($om->get(Magento\Customer\Api\CustomerRepositoryInterface::class)->get($email)->getId()); }
    catch (Magento\Framework\Exception\NoSuchEntityException $e) { /* Not created. */ }
    $rules = $om->create(Magento\SalesRule\Model\ResourceModel\Rule\Collection::class)->addFieldToFilter('name', ['in' => ['Branch checkout CHECKOUT10', 'Branch checkout CHECKOUTFREE']]);
    foreach ($rules as $rule) $rule->delete();
    foreach ($skus as $sku) {
        try { $om->get(Magento\Catalog\Api\ProductRepositoryInterface::class)->deleteById($sku); }
        catch (Magento\Framework\Exception\NoSuchEntityException $e) { /* Not created. */ }
    }
    try { $om->get(Magento\Catalog\Api\ProductAttributeRepositoryInterface::class)->deleteById('checkout_size'); }
    catch (Magento\Framework\Exception\NoSuchEntityException $e) { /* Not created. */ }
    $id = $db->fetchOne($db->select()->from(table('customer_group'), ['customer_group_id'])->where('customer_group_code = ?', $groupCode));
    if ($id) $om->get(Magento\Customer\Api\GroupRepositoryInterface::class)->deleteById((int) $id);
    emit([]);
} else {
    throw new RuntimeException('Unknown checkout fixture action');
}
