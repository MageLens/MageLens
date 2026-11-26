// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

function failureHtmlFilename(title, {attempt = 1, runId = 'run', workerId = 'worker'} = {}) {
    const safe = value => String(value).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 16) || 'unknown';
    const safeTitle = String(title).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);
    return `${safeTitle || 'failed-test'} -- attempt-${Math.max(1, Number(attempt) || 1)} -- ${safe(runId)} -- ${safe(workerId)} (failed).html`;
}

function failureSnapshotDocument(documentOrMetadata = {}, suppliedMetadata = {}) {
    const sourceDocument = documentOrMetadata?.documentElement ? documentOrMetadata : globalThis.document;
    const metadata = documentOrMetadata?.documentElement ? suppliedMetadata : documentOrMetadata;
    if (!sourceDocument?.documentElement || !sourceDocument.createElement) throw new Error('The application document is unavailable.');
    // Build clones in a detached HTML document so custom-element constructors
    // and attribute callbacks cannot run again in the live application page.
    const document = sourceDocument.implementation?.createHTMLDocument?.('') || sourceDocument;

    const maxNodes = 6000;
    const maxSourceCharacters = 100000;
    const maxAttributes = 8000;
    const maxAttributeNameCharacters = 128;
    const maxAttributeCharacters = 1024;
    const maxTextCharacters = 4096;
    const maxOutputBytes = 1024 * 1024;
    const state = {nodes: 0, attributes: 0, characters: 0, truncated: false};
    const scriptOrStyle = new Set(['script', 'style']);
    const resourceAttributes = {
        img: new Set(['src', 'srcset']),
        source: new Set(['src', 'srcset']),
        script: new Set(['src']),
        link: new Set(['href']),
        iframe: new Set(['src']),
        frame: new Set(['src']),
        audio: new Set(['src']),
        video: new Set(['src', 'poster']),
        track: new Set(['src']),
        embed: new Set(['src']),
        object: new Set(['data']),
        input: new Set(['src']),
        image: new Set(['href', 'xlink:href']),
        use: new Set(['href', 'xlink:href']),
        feimage: new Set(['href', 'xlink:href']),
        mpath: new Set(['href', 'xlink:href']),
        portal: new Set(['src'])
    };
    resourceAttributes.base = new Set(['href']);

    function take(value, limit) {
        const text = String(value ?? '');
        const remaining = Math.max(0, maxSourceCharacters - state.characters);
        const result = text.slice(0, Math.min(limit, remaining));
        state.characters += result.length;
        if (result.length < text.length) state.truncated = true;
        return result;
    }

    function cloneNode(source) {
        if (state.nodes >= maxNodes) {
            state.truncated = true;
            return null;
        }
        if (source.nodeType === 3) {
            state.nodes++;
            const content = take(source.nodeValue, maxTextCharacters);
            return document.createTextNode(content);
        }
        if (source.nodeType !== 1) return null;

        state.nodes++;
        const tag = source.localName.toLowerCase();
        const clone = document.createElementNS(source.namespaceURI, source.localName);
        const resourceNames = resourceAttributes[tag] || new Set();
        let copiedAttributes = 0;
        const sourceAttributeCount = source.attributes?.length || 0;
        for (let attributeIndex = 0; attributeIndex < sourceAttributeCount && attributeIndex < 128; attributeIndex++) {
            const attribute = source.attributes[attributeIndex];
            const name = attribute.name.toLowerCase();
            if (name === 'style' || name === 'srcdoc' || name.startsWith('on')) {
                if (name === 'srcdoc') state.truncated = true;
                continue;
            }
            if (tag === 'meta' && name === 'http-equiv' && attribute.value.toLowerCase() === 'refresh') continue;
            if (name === 'value' && ['input', 'textarea'].includes(tag)) continue;
            if (copiedAttributes++ >= 48 || state.attributes >= maxAttributes || name.length > maxAttributeNameCharacters || state.characters + name.length > maxSourceCharacters) {
                state.truncated = true;
                break;
            }
            state.attributes++;
            state.characters += name.length;

            let outputName = name;
            let value = attribute.value;
            const isStylesheetLink = tag === 'link' && /stylesheet|preload|prefetch/i.test(source.getAttribute('rel') || '');
            if (resourceNames.has(name) || (name === 'href' && isStylesheetLink) || name === 'background' || (tag === 'html' && name === 'manifest')) {
                outputName = `data-snapshot-${name.replace(':', '-')}`;
            }
            if (/^data:/i.test(value)) value = '[embedded data omitted]';
            else if (/^javascript:/i.test(value)) value = '[script URL omitted]';
            value = take(value, maxAttributeCharacters);
            if (value || attribute.value === '') clone.setAttribute(outputName, value);
            else state.truncated = true;
        }
        if (sourceAttributeCount > 128) state.truncated = true;

        if (tag === 'input') {
            const type = String(source.type || '').toLowerCase();
            if (type !== 'file' && type !== 'image') {
                const value = type === 'password' || type === 'hidden' ? '[redacted]' : take(source.value, maxAttributeCharacters);
                if (value || source.value === '' || type === 'password' || type === 'hidden') clone.setAttribute('value', value);
            }
            if (source.checked) clone.setAttribute('checked', '');
            else clone.removeAttribute('checked');
        } else if (tag === 'textarea') {
            clone.textContent = take(source.value, maxTextCharacters);
        } else if (tag === 'option') {
            if (source.selected) clone.setAttribute('selected', '');
            else clone.removeAttribute('selected');
        } else if (tag === 'select' && source.multiple) {
            clone.setAttribute('multiple', '');
        }

        if (scriptOrStyle.has(tag)) clone.setAttribute('data-snapshot-content', 'omitted');
        if (tag === 'canvas') clone.setAttribute('data-snapshot-content', 'pixel data omitted');
        if (tag === 'iframe' || tag === 'frame') clone.setAttribute('data-snapshot-content', 'subdocument omitted');

        if (!scriptOrStyle.has(tag) && !['iframe', 'frame', 'canvas', 'textarea'].includes(tag)) {
            const children = tag === 'template' ? source.content?.childNodes : source.childNodes;
            for (let childIndex = 0; childIndex < (children?.length || 0); childIndex++) {
                const childClone = cloneNode(children[childIndex]);
                if (childClone) (tag === 'template' ? clone.content : clone).appendChild(childClone);
                if (state.nodes >= maxNodes || state.characters >= maxSourceCharacters) {
                    state.truncated = true;
                    break;
                }
            }
        }
        return clone;
    }

    const root = cloneNode(sourceDocument.documentElement);
    const head = root?.querySelector?.('head');
    if (!root || !head) throw new Error('The application document could not be serialized.');
    let details;
    try { details = JSON.stringify(metadata).slice(0, 4000); }
    catch { details = '{"metadata":"unavailable"}'; }
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'magelens-failure-snapshot');
    meta.setAttribute('content', details);
    head.insertBefore(meta, head.firstChild);
    if (state.truncated) {
        const note = document.createElement('meta');
        note.setAttribute('name', 'magelens-failure-snapshot-truncated');
        note.setAttribute('content', `Snapshot limits reached; copied ${state.nodes} nodes and ${state.characters} source characters.`);
        head.appendChild(note);
    }

    const output = `<!doctype html>\n${root.outerHTML}`;
    if (new TextEncoder().encode(output).byteLength <= maxOutputBytes) return output;
    const fallback = sourceDocument.implementation.createHTMLDocument('HTML snapshot unavailable');
    const notice = document.createElement('main');
    const heading = document.createElement('h1');
    heading.textContent = 'HTML snapshot truncated';
    const message = document.createElement('p');
    message.textContent = 'The rendered DOM exceeded the 1 MiB snapshot limit.';
    notice.append(heading, message);
    fallback.body.replaceChildren(notice);
    const metadataTag = document.createElement('meta');
    metadataTag.name = 'magelens-failure-snapshot';
    try { metadataTag.content = JSON.stringify(metadata).slice(0, 4000); }
    catch { metadataTag.content = '{"metadata":"unavailable"}'; }
    fallback.head.appendChild(metadataTag);
    return `<!doctype html>\n${fallback.documentElement.outerHTML}`;
}

function failureSnapshotUnavailable(metadata = {}, reason = 'The application page was unavailable.') {
    const safe = value => String(value).replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
    let serialized;
    try { serialized = JSON.stringify(metadata).slice(0, 4000); }
    catch { serialized = '{"metadata":"unavailable"}'; }
    const details = safe(serialized);
    const message = safe(String(reason).slice(0, 500));
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="magelens-failure-snapshot" content="${details}"></head><body><main><h1>HTML snapshot unavailable</h1><p>${message}</p></main></body></html>`;
}

module.exports = {failureHtmlFilename, failureSnapshotDocument, failureSnapshotUnavailable};
