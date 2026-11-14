// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const selectors = new Set(['locator','getByRole','getByText','getByLabel','getByPlaceholder',
    'getByAltText','getByTitle','getByTestId','frameLocator']);
const refinements = new Set(['filter','first','last','nth','and','or']);
const actions = new Set(['click','dblclick','fill','press','check','uncheck','setChecked',
    'selectOption','selectText','setInputFiles','hover','focus','blur','tap','dragTo',
    'pressSequentially','clear','scrollIntoViewIfNeeded']);
const domAssertions = new Set(['toBeAttached','toBeChecked','toBeDisabled','toBeEditable',
    'toBeEmpty','toBeEnabled','toBeFocused','toBeHidden','toBeInViewport','toBeVisible',
    'toContainText','toHaveAttribute','toHaveClass','toHaveCount','toHaveCSS','toHaveId',
    'toHaveJSProperty','toHaveRole','toHaveText','toHaveValue','toHaveValues']);
const member = node => node?.type === 'MemberExpression' && !node.computed;
function receiver(node) {
    if (node?.type === 'Identifier' && node.name === 'page') return 'page';
    if (node?.type !== 'CallExpression' || !member(node.callee)) return null;
    const parent = receiver(node.callee.object), method = node.callee.property.name;
    if (parent && selectors.has(method)) return method === 'frameLocator' ? 'frame' : 'locator';
    if (parent === 'locator' && refinements.has(method)) return 'locator';
    return null;
}

// Return null only for known lazy locator construction. Unknown JavaScript
// retains its ordinary qualified call identity; no project code is executed.
function playwrightCallFeature(node) {
    if (node.type !== 'CallExpression' || !member(node.callee)) return undefined;
    const method = node.callee.property.name, owner = receiver(node.callee.object);
    if (owner && selectors.has(method) || owner === 'locator' && refinements.has(method)) return null;
    if (['page','locator'].includes(owner) && actions.has(method)) return 'playwright.action.' + method;
    let assertion = node.callee.object;
    if (member(assertion) && assertion.property.name === 'not') assertion = assertion.object;
    const expectCall = assertion?.type === 'CallExpression' &&
        (assertion.callee.type === 'Identifier' && assertion.callee.name === 'expect' ||
            member(assertion.callee) && assertion.callee.object.type === 'Identifier' &&
            assertion.callee.object.name === 'expect' && assertion.callee.property.name === 'soft');
    if (expectCall && receiver(assertion.arguments[0]) === 'locator' && domAssertions.has(method))
        return 'playwright.assert.dom';
    return undefined;
}

module.exports = {playwrightCallFeature};
