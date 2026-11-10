// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test, expect, fixtures, headers, get, visitBlog, waitForBlog, search} = require('./support');

test.describe('Blog storefront catalog', () => {
    test('searches, filters, paginates, reads articles, and retains favorites', async ({page}) => {
        const f = fixtures();
        await visitBlog(page, f.query);
        if (f.themePaths[0] === 'Application/coverage') await expect(get(page, 'theme-note')).toContainText('Ideas, engineering');
        await expect(get(page, 'status')).toHaveText('8 articles');
        await expect(get(page, 'post')).toHaveCount(6);
        const first = get(page, 'post').first();
        await get(first, 'details').click();
        await expect(get(first, 'details')).toHaveAttribute('aria-expanded', 'true');
        await expect(get(first, 'post-body')).toContainText('<script>');
        await expect(first.locator('script')).toHaveCount(0);
        await get(first, 'details').click();
        await expect(get(first, 'details')).toHaveAttribute('aria-expanded', 'false');
        await expect(get(first, 'post-body')).toHaveCount(0);
        await get(first, 'favorite').click();
        await expect(get(first, 'favorite')).toHaveText('Unfavorite');
        await expect(get(page, 'favorite-notice')).toContainText('is saved locally.');
        await page.reload();
        await waitForBlog(page);
        await expect(get(page, 'status')).toHaveText('8 articles');
        await expect(get(first, 'favorite')).toHaveText('Unfavorite');
        await get(first, 'favorite').click();
        await expect(get(first, 'favorite')).toHaveText('Favorite');
        await get(page, 'next').click();
        await expect(get(page, 'page-number')).toHaveText('Page 2 of 2');
        await expect(get(page, 'post')).toHaveCount(2);
        await expect(get(page, 'next')).toBeDisabled();
        await get(page, 'previous').click();
        await expect(get(page, 'post')).toHaveCount(6);
        await search(page, f.query, f.prefix + 'people');
        await expect(get(page, 'status')).toHaveText('2 articles');
        await expect(get(page, 'post')).toHaveCount(2);
        await get(first, 'read-post').click();
        await expect(get(page, 'article-title')).toContainText(f.query);
        await expect(get(page, 'article-body')).toContainText('<script>');
        await expect(get(page, 'article-body').locator('script')).toHaveCount(0);
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(f.prefix));
        await expect(get(page, 'no-comments')).toBeVisible();
        await page.getByRole('link', {name: 'All articles'}).click();
        await waitForBlog(page);
        await search(page, f.query, f.prefix + 'engineering');
        await expect(get(page, 'status')).toHaveText('6 articles');
        await search(page, f.query + '-missing');
        await expect(get(page, 'empty')).toBeVisible();
        for (const name of ['post', 'editorial-preview', 'unpublished-post']) await expect(get(page, name)).toHaveCount(0);
        for (let repeat = 0; repeat < 3; repeat++) {
            const response = await page.request.get(`/blog/index/posts?q=${f.query}&category=${f.prefix}people&page=1`, {headers: headers()});
            expect(response.status()).toBe(200);
            const body = await response.json();
            expect(body.total).toBe(2);
            expect(body.posts.map(post => post.slug)).toEqual([f.prefix + 'article-8', f.prefix + 'article-7']);
        }
    });
});
