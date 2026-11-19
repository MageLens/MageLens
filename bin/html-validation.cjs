// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {escapeHtml} = require('./report-index.cjs');

const rawDirectory = 'coverage/raw/html-validation';
const reportDirectory = 'coverage/html-validation';
const preset = 'html-validate:standard';
// The audited document is the server response, before the browser parses and repairs it.
const target = 'source';
let validator;

// Admin URLs and forms carry per-session secrets; the report is published on the local web server.
function redact(text) {
    return text.replace(/\/(key|form_key)\/[^/?#"'\s]+/g, '/$1/[redacted]')
        .replace(/([?&](?:form_key|key|token|SID)=)[^&#"'\s]*/g, '$1[redacted]');
}

function auditedUrl(url) {
    const {origin, pathname, search} = new URL(url);
    return redact(origin + pathname + search);
}

function validateSource(html) {
    const {HtmlValidate} = require('html-validate');
    // root: ignore .htmlvalidate.json files so every project is audited with the same rules.
    validator ||= new HtmlValidate({root: true, extends: [preset]});
    // Findings carry no source text: captured pages can contain personal data and session secrets.
    return validator.validateStringSync(html).results.flatMap(result => result.messages).map(message => ({
        severity: message.severity === 2 ? 'error' : 'warning',
        rule: message.ruleId,
        message: redact(message.message),
        line: message.line,
        column: message.column,
        selector: message.selector ? redact(message.selector) : null,
        ruleUrl: message.ruleUrl || null
    }));
}

// Called by the Cypress task and the Playwright fixture for each mageLensValidateHtml invocation.
// Tests only capture the response; it is validated when the reports are generated, so
// findings and unsupported responses can never fail a test. `error` records a failed request.
function captureHtml({runner, spec, test, url, status, contentType, html, error}) {
    const run = JSON.parse(fs.readFileSync('coverage/run.json', 'utf8')).id;
    fs.mkdirSync(rawDirectory, {recursive: true});
    // File names keep the order of the calls, including several within one millisecond.
    const name = `${Date.now()}-${String(process.hrtime.bigint()).padStart(20, '0')}.json`;
    fs.writeFileSync(path.join(rawDirectory, name), JSON.stringify({
        run, runner, spec, test, capturedAt: new Date().toISOString(), url: auditedUrl(url), status, contentType, html, error
    }));
    return null;
}

// A page that could not be validated must never read as a clean one.
function notValidatedReason({status, contentType, html, error}) {
    if (error) return `the request failed (${redact(String(error))})`;
    if (status >= 300 && status < 400) return `the server answered with an HTTP ${status} redirect`;
    if (typeof html !== 'string' || !/^(text\/html|application\/xhtml\+xml)\b/i.test(contentType || '')) {
        return `the response was ${contentType || 'sent without a content type'}, not an HTML document`;
    }
    return html.trim() ? null : 'the response was empty';
}

function auditCapture({html, error, ...capture}, file) {
    const notValidated = notValidatedReason({html, error, ...capture});
    const messages = notValidated ? [] : validateSource(html);
    const errorCount = messages.filter(message => message.severity === 'error').length;
    return {...capture, target, capture: path.posix.join('raw/html-validation', file), contentType: capture.contentType || null,
        status: capture.status ?? null, notValidated, errorCount, warningCount: messages.length - errorCount, messages};
}

function auditSection(audit) {
    // html-validate stops at markup it cannot tokenize.
    const stopped = audit.messages.some(message => message.rule === 'parser-error')
        ? '<p class="warning">Validation stopped at the parser error; markup after it was not checked.</p>' : '';
    const findings = audit.notValidated
        ? `<p class="warning">Not validated: ${escapeHtml(audit.notValidated)}.</p>`
        : audit.messages.length
        ? `${stopped}<table><thead><tr><th scope="col">Severity</th><th scope="col">Finding</th><th scope="col">Response line</th></tr></thead><tbody>${audit.messages.map(message => `<tr>
<td class="${message.severity}">${message.severity}</td>
<td>${escapeHtml(message.message)}<small>${message.ruleUrl ? `<a href="${escapeHtml(message.ruleUrl)}">${escapeHtml(message.rule)}</a>` : escapeHtml(message.rule)}${message.selector ? ` · <code>${escapeHtml(message.selector)}</code>` : ''}</small></td>
<td>${message.line}:${message.column}</td>
</tr>`).join('\n')}</tbody></table>`
        : '<p class="clean">No issues found.</p>';
    return `<section>
<h2><code>${escapeHtml(audit.url)}</code></h2>
<p class="context">${audit.status === null ? '' : `HTTP ${escapeHtml(audit.status)} · `}${audit.errorCount} errors · ${audit.warningCount} warnings<br>Test: ${escapeHtml(audit.test)}<br>Spec: <code>${escapeHtml(audit.spec)}</code><br>Captured response: <code>coverage/${escapeHtml(audit.capture)}</code></p>
${findings}
</section>`;
}

// Returns the totals shown on the dashboard. Without mageLensValidateHtml invocations no report is
// written, so an unaudited run cannot look like a clean one.
function writeReport(run) {
    const files = fs.existsSync(rawDirectory) ? fs.readdirSync(rawDirectory).filter(file => file.endsWith('.json')).sort() : [];
    const captures = files.map(file => JSON.parse(fs.readFileSync(path.join(rawDirectory, file), 'utf8')));
    if (captures.some(capture => capture.run !== run.id)) throw new Error('HTML validation records belong to another run');
    const audits = captures.map((capture, index) => auditCapture(capture, files[index]));
    const sum = key => audits.reduce((total, audit) => total + audit[key], 0);
    const totals = {audits: audits.length, pages: new Set(audits.map(audit => audit.url)).size,
        errors: sum('errorCount'), warnings: sum('warningCount'), notValidated: audits.filter(audit => audit.notValidated).length};
    if (!audits.length) return totals;
    const engine = {name: 'html-validate', version: require('html-validate/package.json').version, preset};
    fs.mkdirSync(reportDirectory, {recursive: true});
    fs.writeFileSync(path.join(reportDirectory, 'results.json'), JSON.stringify({run: run.id, target, engine, ...totals, audits}, null, 2));
    fs.writeFileSync(path.join(reportDirectory, 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MageLens HTML validation report</title>
<style>
:root { color-scheme: light; font-family: system-ui, sans-serif; color: #172b3a; background: #f3f6f8; }
* { box-sizing: border-box; }
body { margin: 0; }
main { max-width: 1080px; margin: 64px auto; padding: 0 24px; }
h1 { margin: 12px 0; font-size: clamp(28px, 5vw, 40px); letter-spacing: -.03em; }
h2 { margin: 0 0 8px; font-size: 18px; }
p { line-height: 1.6; }
.status { display: inline-block; padding: 6px 12px; border-radius: 20px; background: #e3e9ed; font-size: 14px; font-weight: 600; }
.note, .context { color: #465d6c; font-size: 14px; }
section { margin: 24px 0; padding: 20px 24px; border: 1px solid #d6dfe5; border-radius: 12px; background: white; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; text-align: left; }
thead { font-size: 13px; color: #465d6c; }
th, td { padding: 12px 12px 12px 0; border-top: 1px solid #e3e9ed; vertical-align: top; }
td:last-child { font-variant-numeric: tabular-nums; white-space: nowrap; }
.error { color: #a12622; font-weight: 600; }
.warning { color: #8a5a00; font-weight: 600; }
.clean { color: #17523c; font-weight: 600; }
small { display: block; margin-top: 6px; font-size: 13px; color: #465d6c; }
code { overflow-wrap: anywhere; }
a { color: #086b68; text-underline-offset: 4px; }
footer { border-top: 1px solid #d6dfe5; padding-top: 12px; font-size: 13px; color: #465d6c; }
</style>
</head>
<body>
<main>
<span class="status">${totals.audits} audits · ${totals.pages} pages · ${totals.errors} errors · ${totals.warnings} warnings${totals.notValidated ? ` · ${totals.notValidated} not validated` : ''}</span>
<h1>HTML validation</h1>
<p class="note">Only pages for which a test called <code>mageLensValidateHtml</code> are listed. Each call requests the current URL again with the test session and captures the HTML source of that response, before the browser parses it. The captures are validated after the tests finish. Markup created or changed by JavaScript, responses to form submissions and pages that redirect when requested again are not validated. Coverage runs serve instrumented templates: they add marker comments and coverage counters in attribute values and inline scripts, while elements and line numbers are unchanged. Lines and columns refer to the captured response, which stays in the private <code>coverage/raw/html-validation/</code> directory. Findings never change the test or run result.</p>
${audits.map(auditSection).join('\n')}
<footer>
<p>Run <code>${escapeHtml(run.id)}</code> · ${escapeHtml(engine.name)} ${escapeHtml(engine.version)} (<code>${escapeHtml(engine.preset)}</code>) · <a href="results.json">Validation data (JSON)</a> · <a href="../index.html">Coverage report</a></p>
</footer>
</main>
</body>
</html>
`);
    return totals;
}

module.exports = {captureHtml, auditedUrl, validateSource, writeReport};
