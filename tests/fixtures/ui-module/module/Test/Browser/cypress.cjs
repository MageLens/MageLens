// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {parent, menu, gridHead, columnLabels, rows, input, readOnly, button, initialValue, readOnlyValue,
    proofDirectory, responseId, documentResponse, uiRequest, testValue} = require('./journey.cjs');

function interceptUiRequests() {
    cy.intercept({method: 'GET', pathname: /\/mui\/index\/render(?:\/|$)/}, request => {
        const purpose = uiRequest(request.url);
        if (purpose) request.alias = `uiProbe-${purpose}`;
    });
}

function responseFor(purpose, collect) {
    return cy.wait(`@uiProbe-${purpose}`, {log: false}).then(({response}) => {
        expect(response.statusCode).to.equal(200);
        const id = response.headers['x-magelens-response'];
        if (collect) expect(id).to.match(responseId);
        else expect(id).to.equal(undefined);
        return id ?? null;
    });
}

function pageResponse(collect) {
    return cy.window({log: false}).then(win => {
        const id = documentResponse(win);
        if (collect) expect(id).to.match(responseId);
        else expect(id).to.equal(undefined);
        return id ?? null;
    });
}

function gridRows(expected) {
    cy.get(rows).should(elements => expect([...elements].map(element => element.textContent.trim())).to.deep.equal(expected));
}

function openGrid(admin, collect) {
    interceptUiRequests();
    admin.navigateAdminMenu(parent, menu('listing'));
    cy.get(gridHead).should(elements => expect([...elements].map(element => element.textContent.trim()))
        .to.deep.equal(columnLabels));
    gridRows(['First row', 'Second row']);

    const responses = {};
    pageResponse(collect).then(id => { responses.navigation = id; });
    responseFor('initial', collect).then(id => { responses.initial = id; });
    for (const direction of ['asc', 'desc']) {
        cy.contains(gridHead, 'Untouched column').click();
        responseFor(direction, collect).then(id => { responses[direction] = id; });
        gridRows(direction === 'asc' ? ['First row', 'Second row'] : ['Second row', 'First row']);
    }
    if (collect) cy.then(() => cy.writeFile(`${proofDirectory}/grid.json`, responses, {log: false}));
}

function openForm(admin, collect) {
    interceptUiRequests();
    admin.navigateAdminMenu(parent, menu('form'));
    const responses = {};
    responseFor('form', collect).then(id => { responses.delivery = id; });
    pageResponse(collect).then(id => { responses.navigation = id; });
    cy.get(input).should('be.visible').and('have.value', initialValue);
    cy.get(readOnly).should('be.visible').and('have.text', readOnlyValue);
    cy.get(button('uninvoked')).should('be.visible');
    cy.get(button('uninstantiated')).should('not.exist');
    cy.get(input).clear().type(testValue).blur();
    cy.get(input).should('have.value', testValue);
    return cy.then(() => {
        if (collect) return cy.writeFile(`${proofDirectory}/form.json`, responses, {log: false}).then(() => responses.navigation);
        return responses.navigation;
    });
}

function resetForm(navigation, collect) {
    pageResponse(collect).should('equal', navigation);
    cy.get(input).should('have.value', testValue);
    cy.get(button('invoke')).click();
    cy.get(input).should('have.value', initialValue);
}

function runUiJourney(admin, collect) {
    openGrid(admin, collect);
    openForm(admin, collect).then(navigation => resetForm(navigation, collect));
}

module.exports = {runUiJourney, openGrid, openForm, resetForm};
