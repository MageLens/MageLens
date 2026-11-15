// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const matrix = [
    {id:'short-5', products:1, consumers:5, historicalExpected:'linear', purpose:'Short repeated setup'},
    {id:'reuse-2', products:8, consumers:2, historicalExpected:'linear', purpose:'Same work, low reuse'},
    {id:'boundary-5', products:8, consumers:5, historicalExpected:'linear', purpose:'Reject the former optimistic break-even estimate'},
    {id:'large-5', products:16, consumers:5, historicalExpected:'linear', extended:true, purpose:'Reject a measured but marginal gain under double overhead'},
    {id:'strong-5', products:48, consumers:5, historicalExpected:'branching', purpose:'Substantial shared bulk checkout with conservative headroom'},
    {id:'unrelated-5', products:16, consumers:5, disjoint:true, historicalExpected:'linear', purpose:'Long journeys with different carts'},
    {id:'large-9', products:16, consumers:9, historicalExpected:'linear', extended:true, purpose:'Higher reuse under conservative overhead'},
    {id:'medium-9', products:4, consumers:9, historicalExpected:'linear', extended:true, purpose:'More consumers cannot make tiny work free'},
    {id:'deep-shallow', products:1, consumers:24, levels:12, historicalExpected:'linear', extended:true, purpose:'More than nine shallow branch boundaries; skip uneconomic checkpoints'},
    {id:'deep-large', products:6, consumers:36, levels:12, variantsPerLevel:3, historicalExpected:'branching', extended:true, purpose:'More than nine substantial branch boundaries under a four-checkpoint path budget'},
    {id:'fixture-small-5', products:1, consumers:5, fixture:true, historicalExpected:'linear', historicalExpectedCost:'linear', extended:true, purpose:'Small runtime-dependent fixture stays uneconomic'},
    {id:'fixture-large-9', products:80, consumers:9, fixture:true, historicalExpected:'branching', historicalExpectedCost:'branching', extended:true, purpose:'Reuse an expensive automatically restored fixture'},
    {id:'fixture-state-9', products:80, consumers:9, fixture:true, fixtureState:true, historicalExpected:'branching', historicalExpectedCost:'branching', extended:true, purpose:'Restore fixture values, nested aliases and browser references; execute teardown for every consumer'},
];
const customer = {email:'magelens.performance@example.test', password:'MageLens-Performance-Only-42!'};
const discounts = [0,10,25,100,-1,5,15,20,30];
// Luma initializes cached form keys asynchronously. Wait for the actual token
// and cookie to agree before submitting; do not retry a rejected login.
const loginReady = `() => {const cookie = document.cookie.split('; ').find(value => value.startsWith('form_key=')); return Boolean(cookie && cookie.length > 9 && document.querySelector('.login-container #login-form input[name="form_key"]')?.value === decodeURIComponent(cookie.slice(9)));}`;
const quote = JSON.stringify;
const money = value => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
const product = index => ({sku:`MLPERF-${String(index).padStart(3,'0')}`, path:`/magelens-performance-${index}.html`, name:`MageLens performance product ${index}`, price:10 + index % 7});
function renderSuite(row) {
    if (row.fixture) return renderFixtureSuite(row);
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
        step("page.locator('.login-container #send2').click()");
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
        step(`expect(page.locator('.grand.totals .price')).toHaveText(${quote(money(total))})`);
        step("page.locator('.payment-method._active button.checkout').click()");
        step("expect(page.locator('.checkout-success')).toBeVisible()");
        step("expect(page.locator('h1')).toHaveText('Thank you for your purchase!')");
        step("page.locator('.checkout-success a.order-number').click()");
        step(`expect(page.locator('.order-details-items .product-item-name')).toHaveCount(${items.length})`);
        step(`expect(page.locator('.order-details-items .grand_total .price')).toHaveText(${quote(money(total))})`);
        lines.push('});');
    }
    return lines.join('\n')+'\n';
}
function renderFixtureSuite(row) {
    if (row.disjoint || row.levels) throw new Error('Fixture matrix rows require a common cart');
    const source=renderSuite({...row,fixture:false});
    const parts=source.split(/(?=test\(')/), suffixes=[];
    let common;
    const end="    await expect(page.locator('#checkout-payment-method-load')).toBeVisible();\n";
    for(const part of parts.slice(1)) {
        const start=part.indexOf('    await '), finish=part.indexOf(end)+end.length;
        if(start<0||finish<end.length)throw new Error('Missing checkout fixture boundary');
        const prefix=part.slice(start,finish);
        if(common!==undefined&&common!==prefix)throw new Error('Fixture inputs differ between consumers');
        common=prefix;
        suffixes.push((part.slice(0,start)+part.slice(finish)).replace('async ({page})','async ({page,checkoutReady})'));
    }
    const cartStart=common.indexOf('    await page.goto('+quote(product(1).path)+');');
    const cartEnd=common.indexOf("    await page.goto('/checkout/');");
    if(cartStart<0||cartEnd<=cartStart)throw new Error('Missing cart fixture actions');
    const prepare=common.slice(0,cartStart)+"    await page.goto('/checkout/cart/');\n"+
        "    if (await page.locator('#shopping-cart-table tbody.cart.item').count() === 0) {\n"+
        common.slice(cartStart,cartEnd)+"    }\n"+
        `    await expect(page.locator('#shopping-cart-table tbody.cart.item')).toHaveCount(${row.products});\n`+
        common.slice(cartEnd);
    if(row.fixtureState) {
        const lifecycle=`const test=base.extend({checkoutState:async({page},use)=>{await prepareCheckout(page);const state={page,total:page.locator('.grand.totals .price'),history:[],nested:{count:0}};await use(state);expect(state.history).toEqual(['completed']);expect(state.nested.count).toBe(1);await expect(page.locator('.order-details-items')).toBeVisible();},checkoutReady:async({checkoutState},use)=>{await use({cart:checkoutState});}});\n`;
        const bodies=suffixes.map(body=>body.replace('async ({page,checkoutReady})','async ({page,checkoutState,checkoutReady})')
            .replace('=> {','=> {\n    expect(checkoutReady.cart).toBe(checkoutState);\n    expect(checkoutState.page).toBe(page);\n    expect(checkoutState.history).toEqual([]);\n    expect(checkoutState.nested.count).toBe(0);\n    await expect(checkoutState.total).toBeVisible();')
            .replace(/\}\);\s*$/,"    checkoutState.history.push('completed');\n    checkoutState.nested.count++;\n});\n"));
        return "import {test as base,expect} from '@playwright/test';\n"+'async function prepareCheckout(page) {\n'+prepare+'}\n'+lifecycle+bodies.join('');
    }
    return "import {test as base,expect} from '@playwright/test';\n"+
        'async function prepareCheckout(page) {\n'+prepare+'}\n'+
        'const test=base.extend({checkoutReady:async({page},use)=>{await prepareCheckout(page);await use(true);}});\n'+suffixes.join('');
}
module.exports={matrix,renderSuite,customer,discounts,product,loginReady};
