// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const matrix = [
    {id:'short-5', products:1, consumers:5, expected:'linear', purpose:'Short repeated setup'},
    {id:'reuse-2', products:8, consumers:2, expected:'linear', purpose:'Same work, low reuse'},
    {id:'boundary-5', products:8, consumers:5, expected:'linear', purpose:'Reject the former optimistic break-even estimate'},
    {id:'large-5', products:16, consumers:5, expected:'linear', extended:true, purpose:'Reject a measured but marginal gain under double overhead'},
    {id:'strong-5', products:48, consumers:5, expected:'branching', purpose:'Substantial shared bulk checkout with conservative headroom'},
    {id:'unrelated-5', products:16, consumers:5, disjoint:true, expected:'linear', purpose:'Long journeys with different carts'},
    {id:'large-9', products:16, consumers:9, expected:'linear', extended:true, purpose:'Higher reuse under conservative overhead'},
    {id:'medium-9', products:4, consumers:9, expected:'linear', extended:true, purpose:'More consumers cannot make tiny work free'},
    {id:'deep-shallow', products:1, consumers:24, levels:12, expected:'linear', extended:true, purpose:'More than nine shallow branch boundaries; skip uneconomic checkpoints'},
    {id:'deep-large', products:6, consumers:36, levels:12, variantsPerLevel:3, expected:'branching', extended:true, purpose:'More than nine substantial branch boundaries under a four-checkpoint path budget'},
];
const customer = {email:'magelens.performance@example.test', password:'MageLens-Performance-Only-42!'};
const discounts = [0,10,25,100,-1,5,15,20,30];
// Luma initializes cached form keys asynchronously. Wait for the actual token
// and cookie to agree before submitting; do not retry a rejected login.
const loginReady = `() => {const cookie = document.cookie.split('; ').find(value => value.startsWith('form_key=')); return Boolean(cookie && cookie.length > 9 && document.querySelector('#login-form input[name="form_key"]')?.value === decodeURIComponent(cookie.slice(9)));}`;
const quote = JSON.stringify;
const product = index => ({sku:`MLPERF-${String(index).padStart(3,'0')}`, path:`/magelens-performance-${index}.html`, name:`MageLens performance product ${index}`, price:10 + index % 7});
function renderSuite(row) {
    if (!/^[a-z0-9-]+$/.test(row.id) || !Number.isInteger(row.products) || row.products<1 || row.products>80 ||
        !Number.isInteger(row.consumers) || row.consumers<1 || (row.disjoint&&row.products*row.consumers>80) || (row.levels ? !Number.isInteger(row.levels) || row.levels<1 || row.levels>12 || ![2,3].includes(row.variantsPerLevel??2) || row.consumers!==row.levels*(row.variantsPerLevel??2) || row.products*row.levels>80 : row.consumers>9)) throw new Error('Invalid performance matrix row');
    const lines=["import {test, expect} from '@playwright/test';"];
    for(let variant=0;variant<row.consumers;variant++) {
        const count=row.products*(row.levels?1+Math.floor(variant/(row.variantsPerLevel??2)):1);
        const items=Array.from({length:count},(_,i)=>product(1+i+(row.disjoint?variant*row.products:0)));
        const discount=discounts[row.levels?variant%(row.variantsPerLevel??2):variant], total=(items.reduce((sum,item)=>sum+item.price,0)+5)*(1-Math.max(0,discount)/100);
        lines.push(`test('${row.id} / variant-${variant+1}', async ({page}) => {`);
        const step=code=>lines.push('    await '+code+';');
        step('page.goto("/customer/account/login/")');
        step(`page.locator('#email').fill(${quote(customer.email)})`);
        step(`page.locator('input[name="login[password]"]').fill(${quote(customer.password)})`);
        step(`page.waitForFunction(${loginReady})`);
        step("page.locator('#send2').click()");
        step("expect(page.locator('.box-information')).toBeVisible()");
        items.forEach((item,index)=>{
            step(`page.goto(${quote(item.path)})`);
            step(`expect(page.locator('h1')).toHaveText(${quote(item.name)})`);
            step("page.locator('#qty').fill('1')");
            step("page.locator('#product-addtocart-button').click()");
            step(`expect(page.locator('.message-success')).toContainText(${quote(item.name)})`);
            step("page.goto('/checkout/cart/')");
            step(`expect(page.locator('#shopping-cart-table tbody.cart.item')).toHaveCount(${index+1})`);
        });
        step("page.goto('/checkout/')");
        step("expect(page.locator('#checkout-step-shipping')).toBeVisible()");
        step("page.locator('input[value=flatrate_flatrate]').check()");
        step("page.locator('#shipping-method-buttons-container button.continue').click()");
        step("expect(page.locator('#checkout-payment-method-load')).toBeVisible()");
        if(discount!==0) {
            step("page.locator('.discount-code .payment-option-title').click()");
            step(`page.locator('#discount-code').fill(${quote(discount<0?'MLPERF-INVALID':`MLPERF-${discount}`)})`);
            step("page.locator('.discount-code button.action-apply').click()");
            step(discount<0?"expect(page.locator('.message-error')).toBeVisible()":"expect(page.locator('.discount-code button.action-cancel')).toBeVisible()");
        }
        step(`page.locator('input[value=${discount===100?'free':'checkmo'}]').check()`);
        step(`expect(page.locator('.grand.totals .price')).toHaveText(${quote('$'+total.toFixed(2))})`);
        step("page.locator('.payment-method._active button.checkout').click()");
        step("expect(page.locator('.checkout-success')).toBeVisible()");
        step("expect(page.locator('h1')).toHaveText('Thank you for your purchase!')");
        step("page.locator('.checkout-success a.order-number').click()");
        step(`expect(page.locator('.order-details-items .product-item-name')).toHaveCount(${items.length})`);
        step(`expect(page.locator('.order-details-items .grand_total .price')).toHaveText(${quote('$'+total.toFixed(2))})`);
        lines.push('});');
    }
    return lines.join('\n')+'\n';
}
module.exports={matrix,renderSuite,customer,discounts,product,loginReady};
