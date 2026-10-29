describe('Storefront warm-up', () => {
    it('loads the homepage and fixture pages with their dynamic assets', () => {
        for (const path of Cypress.expose('warmupPaths')) {
            cy.visit(path);
            cy.warmupReady();
        }
    });
});
