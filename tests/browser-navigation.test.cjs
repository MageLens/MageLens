// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {adminScriptDependencies, installCypressAdminDependencies, installPlaywrightAdminDependencies} = require('../bin/browser-navigation.cjs');

const script = `require(['jquery', 'Magento_Ui/js/modal/alert', 'mage/translate', 'domReady!'], function ($, alert, $t) {
    var locations = ['cart', 'checkout'];
    locations.each(function (location) { window.visited.push(location); });
    if (window.failApplication) throw new Error('real application failure');
});`;

function execute(source, failApplication = false) {
    const realm = vm.createContext({});
    vm.runInContext(`window = {visited: [], failApplication: ${failApplication}};
        function require(deps, callback) {
            if (deps.includes('prototype')) Array.prototype.each = function (visit) { this.forEach(visit); };
            callback();
        }`, realm);
    vm.runInContext(source, realm);
    return Array.from(realm.window.visited);
}

test('Braintree waits for Prototype without changing source lines or suppressing application failures', () => {
    assert.throws(() => execute(script), /locations.each is not a function/);
    const fixed = adminScriptDependencies(script);
    assert.deepEqual(execute(fixed), ['cart', 'checkout']);
    assert.equal(fixed.split('\n').length, script.split('\n').length);
    assert.equal(adminScriptDependencies(fixed), fixed, 'An upstream dependency fix must remain unchanged');
    assert.throws(() => execute(fixed, true), /real application failure/);
    assert.throws(() => adminScriptDependencies('unexpected source'), /Unsupported Braintree/);
    assert.equal(script.includes("'prototype'"), false, 'The original source stays unchanged');
    const formatted = script.replaceAll("'", '"').replace("\"domReady!\"", '"domReady!",\r\n');
    assert.deepEqual(execute(adminScriptDependencies(formatted)), ['cart', 'checkout']);
});

test('both browser response hooks use the same dependency fix and preserve HTTP failures', async () => {
    let cypressHandler;
    let cypressPattern;
    installCypressAdminDependencies({intercept(options, handler) { cypressPattern = options.url; cypressHandler = handler; }});
    let cypressResponse;
    cypressHandler({on(event, handler) { assert.equal(event, 'before:response'); cypressResponse = handler; }});
    const response = {statusCode: 200, body: script};
    cypressResponse(response);
    const url = 'https://shop.test/static/version123/adminhtml/Magento/backend/en_US/PayPal_Braintree/js/system.js?v=1';
    let paused;
    const commands = [];
    let delivered = script;
    const session = {
        on(event, handler) { assert.equal(event, 'Fetch.requestPaused'); paused = handler; },
        async send(method, params) {
            commands.push({method, params});
            if (method === 'Fetch.getResponseBody') return {body: Buffer.from(delivered).toString('base64'), base64Encoded: true};
        }
    };
    const originalNewPage = async () => ({});
    const context = {pages: () => [{}], newPage: originalNewPage, on() {}, off() {}, newCDPSession: async () => session};
    const check = await installPlaywrightAdminDependencies(context);
    assert.ok(cypressPattern.test(url));
    assert.equal(cypressPattern.test('https://shop.test/static/Magento_Config/js/system.js'), false);
    const request = {requestId: 'script', request: {url}, responseStatusCode: 200, responseHeaders: [
        {name: 'Content-Type', value: 'application/javascript'}, {name: 'Content-Encoding', value: 'gzip'},
        {name: 'Content-Length', value: '12'}, {name: 'ETag', value: 'original'}
    ]};
    await paused(request);
    const fulfilled = commands.find(command => command.method === 'Fetch.fulfillRequest').params;
    assert.equal(response.body, Buffer.from(fulfilled.body, 'base64').toString());
    assert.deepEqual(fulfilled.responseHeaders, [{name: 'Content-Type', value: 'application/javascript'},
        {name: 'Content-Length', value: String(Buffer.byteLength(response.body))}, {name: 'Cache-Control', value: 'no-store'}]);
    assert.ok(commands.every(command => command.method.startsWith('Fetch.')), 'The adapter must not disable the browser cache');
    const failed = {statusCode: 500, body: 'server failure'};
    cypressResponse(failed);
    assert.equal(failed.body, 'server failure');
    await paused({...request, responseStatusCode: 500});
    assert.equal(commands.at(-1).method, 'Fetch.continueResponse');
    check();
    assert.equal(context.newPage, originalNewPage);
    delivered = 'unexpected source';
    await paused(request);
    assert.equal(commands.at(-1).method, 'Fetch.failRequest');
    assert.throws(check, /response hook failed/);
});
