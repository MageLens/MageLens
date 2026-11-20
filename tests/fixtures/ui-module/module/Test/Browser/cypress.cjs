// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {parent, menu, listingEffects, formEffects, fields, provider, gridHead, columnLabels, rows,
    input, button, responseId, documentResponse, sortingRequest, testValue} = require('./journey.cjs');

function observe(expected, response) {
    expect(response).to.match(responseId);
    cy.window({log: false}).should(win => {
        const observed = win.__mageLensUiEffects.snapshot();
        for (const {identity, type} of expected) {
            expect(observed.some(entry => entry.identity === identity && entry.type === type && entry.response === response),
                `${identity} ${type}`).to.equal(true);
        }
    });
    for (const effect of expected) cy.task('recordXmlBrowserEvidence', {...effect, response}, {log: false});
}

function gridRows(expected) {
    cy.get(rows).should(elements => expect([...elements].map(element => element.textContent.trim())).to.deep.equal(expected));
}

function runUiJourney(admin, collect) {
    cy.intercept({method: 'GET', pathname: /\/mui\/index\/render(?:\/|$)/}, request => {
        const direction = sortingRequest(request.url);
        if (direction) request.alias = `uiProbe-${direction}`;
    });

    admin.navigateAdminMenu(parent, menu('listing'));
    cy.get(gridHead).should(elements => expect([...elements].map(element => element.textContent.trim()))
        .to.deep.equal(columnLabels));
    gridRows(['First row', 'Second row']);
    let listingResponse;
    cy.window({log: false}).then(win => {
        listingResponse = documentResponse(win);
        if (collect) observe(listingEffects, listingResponse);
        else expect(listingResponse).to.equal(undefined);
    });
    for (const direction of ['asc', 'desc']) {
        cy.contains(gridHead, 'Untouched column').click();
        cy.wait(`@uiProbe-${direction}`, {log: false}).then(({response}) => {
            expect(response.statusCode).to.equal(200);
            const reloadResponse = response.headers['x-magelens-response'];
            if (collect && direction === 'desc') {
                expect(reloadResponse).not.to.equal(listingResponse);
                observe([{type: 'ui-reloaded', identity: provider}], reloadResponse);
            } else if (!collect) expect(reloadResponse).to.equal(undefined);
        });
        gridRows(direction === 'asc' ? ['First row', 'Second row'] : ['Second row', 'First row']);
    }

    admin.navigateAdminMenu(parent, menu('form'));
    cy.get(input).should('be.visible');
    cy.get(button('uninvoked')).should('be.visible');
    cy.get(button('uninstantiated')).should('not.exist');
    let formResponse, initial;
    cy.window({log: false}).then(win => {
        formResponse = documentResponse(win);
        initial = win.document.querySelector(input).value;
        if (collect) observe(formEffects.filter(effect => effect.type !== 'ui-action-invoked'), formResponse);
        else expect(formResponse).to.equal(undefined);
    });
    cy.get(input).clear().type(testValue);
    cy.get(input).should('have.value', testValue);
    cy.get(button('invoke')).click();
    cy.get(input).should(element => expect(element[0].value === initial, 'native reset restored the initial form value').to.equal(true));
    if (collect) {
        cy.then(() => observe([{identity: fields + 'invoke', type: 'ui-action-invoked'}], formResponse));
        cy.window({log: false}).then(win => {
            expect(win.__mageLensUiEffects.snapshot().filter(entry => entry.identity === fields + 'uninstantiated' ||
                (entry.identity === fields + 'uninvoked' && entry.type === 'ui-action-invoked'))).to.deep.equal([]);
        });
    }
}

module.exports = {runUiJourney};
