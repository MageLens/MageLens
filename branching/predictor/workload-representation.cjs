// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const parser = require('@babel/parser');

const WORKLOAD_REPRESENTATION_VERSION = 'workload-representation-v2';

function classifyDomain(rawTarget, {simulatorOrigins = [], applicationOrigins = []} = {}) {
    if (typeof rawTarget !== 'string' || !rawTarget.trim()) return 'unknown';
    const target = rawTarget.trim();
    if (!target.startsWith('//') && !/^[a-z][a-z0-9+.-]*:/i.test(target)) return 'internal_application';
    try {
        const url = new URL(target);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'unknown';
        if (applicationOrigins.includes(url.origin)) return 'internal_application';
        if (simulatorOrigins.includes(url.origin)) return 'local_simulator';
        return 'external_provider';
    } catch {
        return 'unknown';
    }
}

function classifySubsystem(target, name) {
    const text = `${target ?? ''} ${name ?? ''}`.toLowerCase();
    if (/(?:reindex|index|search|elasticsearch|opensearch)/.test(text)) return 'search_indexing';
    if (/(?:seed|clean|truncate|db|reset|sql|migrate|fixture)/.test(text)) return 'database';
    return null;
}

function extractStringValue(node) {
    if (!node) return null;
    if (node.type === 'StringLiteral') return node.value;
    if (node.type === 'TemplateLiteral' && node.quasis.length === 1) return node.quasis[0].value.raw;
    return null;
}

function getRootReceiver(node) {
    let curr = node;
    while (curr) {
        if (curr.type === 'Identifier') return curr.name;
        if (curr.type === 'MemberExpression' || curr.type === 'OptionalMemberExpression') curr = curr.object;
        else if (curr.type === 'CallExpression' || curr.type === 'OptionalCallExpression') curr = curr.callee;
        else break;
    }
    return null;
}

function representWorkload(sources = [], options = {}, sourceBoundaries = new Map()) {
    const boundaries = [];
    const timingBoundary = options.timingBoundary ?? 'cypress-test-duration-minus-preparation/v2';
    const knownCommands = options.knownCommands ?? new Set();
    const knownTasks = options.knownTasks ?? new Set();

    for (const file of sources) {
        if (!file.source) continue;
        const cached = sourceBoundaries.get(file);
        if (cached) {
            for (const boundary of cached) boundaries.push(boundary);
            continue;
        }
        let ast;
        try {
            ast = parser.parse(file.source, {sourceType: 'unambiguous', plugins: ['typescript', 'jsx']});
        } catch {
            sourceBoundaries.set(file,[]);
            continue;
        }
        const firstBoundary = boundaries.length;

        const pending = [ast];
        while (pending.length) {
            const node = pending.pop();
            if (!node || typeof node !== 'object') continue;
            if (Array.isArray(node)) {
                pending.push(...node);
                continue;
            }

            if (['CallExpression', 'OptionalCallExpression'].includes(node.type)) {
                const callee = node.callee;
                let calleeName = null;
                let receiverName = null;
                let rootReceiver = null;
                let propName = null;

                if (callee.type === 'Identifier') {
                    calleeName = callee.name;
                } else if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
                    propName = callee.property?.name ?? callee.property?.value ?? null;
                    if (callee.object?.type === 'Identifier') {
                        receiverName = callee.object.name;
                    }
                    rootReceiver = getRootReceiver(callee.object);
                }

                // 1. Navigation: cy.visit(...) or page.goto(...)
                if (((receiverName === 'cy' || rootReceiver === 'cy') && propName === 'visit') ||
                    (receiverName === 'page' && propName === 'goto')) {
                    const rawTarget = extractStringValue(node.arguments[0]);
                    const domain = classifyDomain(rawTarget,options);
                    boundaries.push({
                        kind: 'navigation',
                        command: `${receiverName}.${propName}`,
                        target: rawTarget ?? '<dynamic_route>',
                        domain,
                        subsystem: 'server_rendering',
                        represented: false,
                        file: file.name,
                        role: file.role ?? 'work',
                        opacityReason: 'server_side_rendering',
                        description: 'Server-side layout, block and controller rendering (PHP/backend)',
                        prerunInfo: {
                            target: rawTarget ?? '<dynamic_route>',
                            method: 'GET',
                            hasOptions: node.arguments.length > 1
                        }
                    });
                }

                // 2. HTTP / API Requests: cy.request(...) or page.request / request.post / fetch / axios
                else if ((receiverName === 'cy' && propName === 'request') ||
                    (['request', 'api'].includes(receiverName) && ['get', 'post', 'put', 'delete', 'patch'].includes(propName)) ||
                    (calleeName === 'fetch' || (receiverName === 'axios' && ['get', 'post', 'put', 'delete'].includes(propName)))) {
                    let method = 'GET';
                    let rawTarget = null;
                    let hasStaticPayload = false;
                    let payloadSizeEstimate = 0;

                    if (receiverName === 'cy' && propName === 'request') {
                        if (node.arguments.length >= 2 && extractStringValue(node.arguments[0])) {
                            method = extractStringValue(node.arguments[0]).toUpperCase();
                            rawTarget = extractStringValue(node.arguments[1]);
                            if (node.arguments[2]) {
                                hasStaticPayload = true;
                                payloadSizeEstimate = node.arguments[2].end - node.arguments[2].start;
                            }
                        } else if (node.arguments[0]?.type === 'ObjectExpression') {
                            for (const prop of node.arguments[0].properties) {
                                const key = prop.key?.name ?? prop.key?.value;
                                if (key === 'method') method = (extractStringValue(prop.value) ?? 'GET').toUpperCase();
                                if (key === 'url') rawTarget = extractStringValue(prop.value);
                                if (key === 'body') {
                                    hasStaticPayload = true;
                                    payloadSizeEstimate = prop.value.end - prop.value.start;
                                }
                            }
                        } else {
                            rawTarget = extractStringValue(node.arguments[0]);
                        }
                    } else if (propName && ['get', 'post', 'put', 'delete', 'patch'].includes(propName)) {
                        method = propName.toUpperCase();
                        rawTarget = extractStringValue(node.arguments[0]);
                        if (node.arguments[1]) {
                            hasStaticPayload = true;
                            payloadSizeEstimate = node.arguments[1].end - node.arguments[1].start;
                        }
                    }

                    const domain = classifyDomain(rawTarget,options);
                    const subsystem = classifySubsystem(rawTarget, null) ?? 'server_controller';
                    boundaries.push({
                        kind: 'api_request',
                        command: receiverName ? `${receiverName}.${propName}` : (calleeName ?? 'fetch'),
                        method,
                        target: rawTarget ?? '<dynamic_endpoint>',
                        domain,
                        subsystem,
                        represented: false,
                        file: file.name,
                        role: file.role ?? 'work',
                        opacityReason: 'server_side_controller',
                        description: `Server-side endpoint execution (${method} ${rawTarget ?? '<dynamic>'}); database operations and controller work`,
                        prerunInfo: {
                            target: rawTarget ?? '<dynamic_endpoint>',
                            method,
                            hasStaticPayload,
                            payloadBytes: payloadSizeEstimate
                        }
                    });
                }

                // 3. Runner Tasks: cy.task(...)
                else if (receiverName === 'cy' && propName === 'task') {
                    const taskName = extractStringValue(node.arguments[0]);
                    const isResolved = taskName ? knownTasks.has(taskName) : false;
                    const subsystem = classifySubsystem(null, taskName) ?? 'runner_process';
                    boundaries.push({
                        kind: 'runner_task',
                        command: 'cy.task',
                        target: taskName ?? '<dynamic_task>',
                        domain: 'internal_runner',
                        subsystem,
                        represented: isResolved,
                        file: file.name,
                        role: file.role ?? 'work',
                        opacityReason: isResolved ? 'runner_subprocess_or_database' : 'opaque_runner_task',
                        description: isResolved
                            ? `Runner task handler '${taskName}' is reachable; subprocess/database actions remain opaque`
                            : `Runner task handler '${taskName ?? '<dynamic>'}' is not resolved in project support context`,
                        prerunInfo: {
                            taskName: taskName ?? '<dynamic_task>',
                            hasArg: node.arguments.length > 1
                        }
                    });
                }

                // 4. Custom commands: cy.<customCommand>(...)
                else if ((receiverName === 'cy' || rootReceiver === 'cy') && propName && !isCypressBuiltin(propName)) {
                    const isResolved = knownCommands.has(propName);
                    boundaries.push({
                        kind: 'custom_command',
                        command: `cy.${propName}`,
                        target: propName,
                        domain: 'internal_application',
                        subsystem: 'browser_client',
                        represented: isResolved,
                        file: file.name,
                        role: file.role ?? 'work',
                        opacityReason: isResolved ? null : 'unresolved_custom_command',
                        description: isResolved
                            ? `Custom command 'cy.${propName}' implementation resolved in support context`
                            : `Custom command 'cy.${propName}' implementation is not in parsed support context`,
                        prerunInfo: {
                            command: propName,
                            argCount: node.arguments.length
                        }
                    });
                }

                // 5. Client interactions & assertions
                else if (((receiverName === 'cy' || rootReceiver === 'cy') && isCypressBuiltin(propName)) ||
                         (receiverName === 'page' && ['locator', 'click', 'fill', 'check', 'keyboard', 'mouse'].includes(propName)) ||
                         ['expect', 'assert'].includes(calleeName)) {
                    boundaries.push({
                        kind: 'browser_client',
                        command: (receiverName || rootReceiver) ? `${receiverName || rootReceiver}.${propName}` : calleeName,
                        target: propName ?? calleeName,
                        domain: 'browser_runner',
                        subsystem: 'browser_client',
                        represented: true,
                        file: file.name,
                        role: file.role ?? 'work',
                        opacityReason: null,
                        description: 'Client-side DOM events, assertions and browser commands represented in JavaScript syntax vector'
                    });
                }
            }

            for (const [k, v] of Object.entries(node)) {
                if (!['loc', 'comments', 'leadingComments', 'trailingComments'].includes(k) && v && typeof v === 'object') {
                    pending.push(v);
                }
            }
        }
        sourceBoundaries.set(file,boundaries.slice(firstBoundary));
    }

    const representedBoundaries = boundaries.filter(b => b.represented);
    const opaqueBoundaries = boundaries.filter(b => !b.represented);

    const providerDomains = {
        unknown: boundaries.filter(b => b.domain === 'unknown').length,
        internal_application: boundaries.filter(b => b.domain === 'internal_application').length,
        local_simulator: boundaries.filter(b => b.domain === 'local_simulator').length,
        external_provider: boundaries.filter(b => b.domain === 'external_provider').length,
        internal_runner: boundaries.filter(b => b.domain === 'internal_runner').length,
        browser_runner: boundaries.filter(b => b.domain === 'browser_runner').length
    };

    const subsystems = {
        server_rendering: boundaries.filter(b => b.subsystem === 'server_rendering').length,
        server_controller: boundaries.filter(b => b.subsystem === 'server_controller').length,
        database: boundaries.filter(b => b.subsystem === 'database').length,
        search_indexing: boundaries.filter(b => b.subsystem === 'search_indexing').length,
        runner_process: boundaries.filter(b => b.subsystem === 'runner_process').length,
        browser_client: boundaries.filter(b => b.subsystem === 'browser_client').length
    };

    const opaqueCategories = [...new Set(opaqueBoundaries.map(b => b.kind))];
    const representedCategories = [...new Set(representedBoundaries.map(b => b.kind))];

    const limitations = [];
    if (opaqueBoundaries.length > 0) {
        limitations.push(`Workload contains ${opaqueBoundaries.length} server-side/runner operation(s) (${opaqueCategories.join(', ')}) whose execution, database queries, and backend latency are opaque to JavaScript syntax AST models.`);
    }
    if (providerDomains.external_provider > 0) {
        limitations.push(`Workload references ${providerDomains.external_provider} external provider endpoint(s); real network response latency cannot be established under local simulator measurements.`);
    }

    return {
        schemaVersion: WORKLOAD_REPRESENTATION_VERSION,
        boundaries,
        summary: {
            totalBoundaries: boundaries.length,
            representedCount: representedBoundaries.length,
            opaqueCount: opaqueBoundaries.length,
            hasOpaqueWork: opaqueBoundaries.length > 0,
            opaqueCategories,
            representedCategories,
            providerDomains,
            subsystems,
            limitations
        },
        supportsForecast: {
            timingBoundary,
            dataBasis: 'Static call sites in the supplied work fragments',
            limitations: [
                'Call-site counts do not measure runtime frequency or expand imported helpers',
                'Opaque server-side work is estimated solely via correlated client call syntax and historical baseline, not direct backend execution analysis',
                'Local provider simulators cannot establish real external provider network latency'
            ]
        }
    };
}

function summarizeWorkloadRepresentations(testRows = [], stageRows = []) {
    const all = [...testRows, ...stageRows].map(r => r.workload).filter(Boolean);
    const totalBoundaries = all.reduce((s, w) => s + (w.summary?.totalBoundaries ?? 0), 0);
    const opaqueCount = all.reduce((s, w) => s + (w.summary?.opaqueCount ?? 0), 0);
    const representedCount = all.reduce((s, w) => s + (w.summary?.representedCount ?? 0), 0);
    const opaqueWorkloads = all.filter(w => w.summary?.hasOpaqueWork).length;

    const providerDomains = {
        unknown: all.reduce((sum,w)=>sum+(w.summary?.providerDomains?.unknown ?? 0),0),
        internal_application: all.reduce((s, w) => s + (w.summary?.providerDomains?.internal_application ?? 0), 0),
        local_simulator: all.reduce((s, w) => s + (w.summary?.providerDomains?.local_simulator ?? 0), 0),
        external_provider: all.reduce((s, w) => s + (w.summary?.providerDomains?.external_provider ?? 0), 0),
        internal_runner: all.reduce((s, w) => s + (w.summary?.providerDomains?.internal_runner ?? 0), 0),
        browser_runner: all.reduce((s, w) => s + (w.summary?.providerDomains?.browser_runner ?? 0), 0)
    };

    const subsystems = {
        server_rendering: all.reduce((s, w) => s + (w.summary?.subsystems?.server_rendering ?? 0), 0),
        server_controller: all.reduce((s, w) => s + (w.summary?.subsystems?.server_controller ?? 0), 0),
        database: all.reduce((s, w) => s + (w.summary?.subsystems?.database ?? 0), 0),
        search_indexing: all.reduce((s, w) => s + (w.summary?.subsystems?.search_indexing ?? 0), 0),
        runner_process: all.reduce((s, w) => s + (w.summary?.subsystems?.runner_process ?? 0), 0),
        browser_client: all.reduce((s, w) => s + (w.summary?.subsystems?.browser_client ?? 0), 0)
    };

    const opaqueCategories = [...new Set(all.flatMap(w => w.summary?.opaqueCategories ?? []))];
    const representedCategories = [...new Set(all.flatMap(w => w.summary?.representedCategories ?? []))];

    return {
        version: WORKLOAD_REPRESENTATION_VERSION,
        totalWorkloads: all.length,
        opaqueWorkloads,
        fullyRepresentedWorkloads: all.length - opaqueWorkloads,
        totalBoundaries,
        representedCount,
        opaqueCount,
        opaqueCategories,
        representedCategories,
        providerDomains,
        subsystems,
        limitations: [
            'Server-side PHP/backend execution, database transactions, and indexing latency are opaque to JavaScript AST models and must be reported separately',
            'External provider calls must not be evaluated using local simulator baselines'
        ]
    };
}

const CYPRESS_BUILTINS = new Set([
    'get', 'contains', 'find', 'filter', 'not', 'eq', 'first', 'last',
    'click', 'dblclick', 'rightclick', 'type', 'clear', 'check', 'uncheck', 'select', 'trigger',
    'should', 'and', 'then', 'each', 'spread', 'its', 'invoke', 'as', 'wrap',
    'wait', 'log', 'focused', 'blur', 'submit', 'scrollIntoView', 'scrollTo',
    'viewport', 'screenshot', 'title', 'url', 'location', 'window', 'document',
    'setCookie', 'getCookie', 'getCookies', 'clearCookie', 'clearCookies', 'clearLocalStorage',
    'fixture', 'intercept', 'route', 'server', 'clock', 'tick', 'spy', 'stub'
]);

function isCypressBuiltin(name) {
    return CYPRESS_BUILTINS.has(name);
}

module.exports = {
    WORKLOAD_REPRESENTATION_VERSION,
    representWorkload,
    summarizeWorkloadRepresentations,
    classifyDomain,
    classifySubsystem
};
