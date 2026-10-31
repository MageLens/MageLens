// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const {test, expect} = require('../../../../../../../playwright/support.cjs');
const fixtures = () => JSON.parse(fs.readFileSync('coverage/project-fixtures.json')).Application_Blog;
const headers = () => ({'x-application-coverage': JSON.parse(fs.readFileSync('coverage/run.json')).id});
const get = (page, name) => page.locator(`[data-cy="${name}"]`);
const message = (page, type) => page.locator(`.message-${type}, [ui-id="message-${type}"]`);
async function waitForBlog(page) {
    await expect(get(page, 'status')).toHaveText(/^[0-9]+ articles$/);
    await expect(get(page, 'search-submit')).toBeEnabled();
}
async function visitBlog(page, query = '') {
    await page.goto('/blog/' + (query ? '?q=' + encodeURIComponent(query) : ''));
    await waitForBlog(page);
}
async function search(page, query, category = '') {
    await get(page, 'search').fill(query);
    await get(page, 'category').selectOption(category);
    const response = page.waitForResponse(response => response.url().includes('/blog/index/posts'));
    await get(page, 'search-submit').click();
    await response;
    await waitForBlog(page);
}
async function login(page, username = 'application', password = 'ApplicationOnly123456!') {
    await page.goto('/admin/');
    await page.locator('#username').fill(username);
    await page.locator('#login').fill(password);
    await page.locator('.action-login').click();
    await expect(page.locator('#nav')).toBeVisible();
}
async function section(page, name) {
    await expect(page.locator('.admin__menu-overlay')).toBeAttached();
    await page.locator('#menu-application-blog-manage > a').click();
    await page.locator(`[data-ui-id="menu-application-blog-${name}"] > a`).click();
    await expect(get(page, 'blog-admin')).toBeVisible();
}
async function findRecord(page, name) {
    await get(page, 'admin-search').fill(name);
    await get(page, 'admin-search-submit').click();
    await expect(get(page, 'admin-row')).toHaveCount(1);
    await get(page, 'admin-edit').click();
    await expect(get(page, 'blog-editor')).toBeVisible();
}
async function save(page) {
    await get(page, 'admin-save').click();
    await expect(message(page, 'success')).toContainText('Saved successfully.');
}
async function remove(page) {
    await get(page, 'admin-delete').click();
    await page.locator('.modal-popup._show .action-accept').click();
    await expect(message(page, 'success')).toContainText('Deleted successfully.');
}
async function fillPost(page, title, slug, category) {
    for (const [field, value] of Object.entries({title, slug, author: 'Editorial team',
        excerpt: 'An article written and published from Magento Admin.',
        body: 'A complete publishing workflow.\nReader input stays plain text: <script>alert(1)</script>.'})) {
        await page.locator('#blog-' + field).fill(value);
    }
    await page.locator('#blog-category').selectOption({label: category});
}
async function fillComment(page, name, email, body) {
    const form = get(page, 'comment-form');
    for (const [field, value] of Object.entries({name, email, body})) await form.locator(`[name="${field}"]`).fill(value);
}
module.exports = {test, expect, fixtures, headers, get, message, waitForBlog, visitBlog, search, login, section, findRecord, save, remove, fillPost, fillComment};
