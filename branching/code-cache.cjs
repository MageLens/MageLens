// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// A run-local cache of public, immutable static code. No storefront HTML, media, API,
// customer responses, authenticated requests or cookie-bearing replies qualify.
function eligibleRequest(request, origin) {
    const url = new URL(request.url()), headers = request.headers();
    return url.origin === origin && request.method() === 'GET' && !headers.authorization &&
        /^\/static\/(?:version\d+\/)?(?:frontend|adminhtml|_requirejs)\/.+\.(?:js|css|html|json|woff2?|ttf|otf|eot|svg|png|jpe?g|gif|ico)$/i.test(url.pathname);
}
function eligibleResponse(status, headers) {
    const directives = (headers['cache-control'] || '').toLowerCase().split(',').map(value => value.trim());
    const vary = (headers.vary || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
    return status === 200 && directives.includes('public') && directives.includes('immutable') &&
        !directives.some(value => /^(private|no-store|no-cache)(?:=|$)/.test(value)) &&
        !headers['set-cookie'] && vary.every(value => value === 'accept-encoding');
}
class CodeCache {
    constructor(origin, budget = 128 * 1024 * 1024) {
        this.origin = origin; this.budget = budget; this.bytes = 0; this.entries = new Map();
        this.stats = {hits: 0, misses: 0, stored: 0}; this.errors = [];
    }
    async install(context) {
        await context.route('**/*', route => this.handle(route).catch(async error => {
            this.errors.push(error.message);
            await route.abort().catch(() => {}); // The page may already be closed.
        }));
    }
    async handle(route) {
        const request = route.request();
        if (!eligibleRequest(request, this.origin)) return route.continue();
        const key = request.url(), cached = this.entries.get(key);
        if (cached) { this.stats.hits++; return route.fulfill(cached); }
        this.stats.misses++;
        const response = await route.fetch();
        try {
            const headers = response.headers();
            if (!eligibleResponse(response.status(), headers)) return await route.fulfill({response});
            const body = await response.body();
            // Playwright returns a decoded body; stale transport headers corrupt it.
            for (const name of ['content-length', 'content-encoding', 'transfer-encoding', 'connection']) delete headers[name];
            const value = {status: response.status(), headers, body};
            if (!this.entries.has(key) && this.bytes + body.length <= this.budget) {
                this.entries.set(key, value); this.bytes += body.length; this.stats.stored++;
            }
            return await route.fulfill(value);
        } finally { await response.dispose(); }
    }
}
module.exports = {CodeCache, eligibleRequest, eligibleResponse};
