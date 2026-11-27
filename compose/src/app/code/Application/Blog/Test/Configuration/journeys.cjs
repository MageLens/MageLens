// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Shared real HTTP expectations for both pinned browser runners.
const journeys = [
    ['baseline', {}],
    ['preference-resolution', {shared: true, fresh: true, failed: true,
        area: 'Application\\Blog\\Model\\JournalFrontendPreference',
        external: 'Application\\Blog\\Model\\JournalFrontendPreference',
        virtual: 'Application\\Blog\\Model\\JournalPreferenceProbe',
        lookup: 'Application\\Blog\\Model\\JournalPreferenceProbe',
        arguments: {label: 'frontend label', shared: true, options: {enabled: true},
            override: 'caller', concrete: 'global label', failed: true, dependency: true}}],
    ['observer-dispatch', {hits: 2, external: true, plugin: 'short:startbbxb|after'}],
    ['default-read', {heading: 'Journal'}],
    ['backend-reads', {heading: 'Backend journal', enabled: true}],
    ['store-alias-read', {heading: 'Website journal', lowercase: 'Website journal'}],
    ['website-read', {heading: 'Website journal'}],
    ['store-read', {heading: 'Store journal'}],
    ['store-inherits-website', {heading: 'Website journal'}],
    ['store-inherits-default', {heading: 'Journal'}],
    ['website-inherits-default', {heading: 'Journal'}],
    ['database-override', {overridden: 'Default editorial notice'}],
    ['value-reads', {enabled: false, empty: null}],
    ['subtree-read', {data: {first: 'First returned leaf', second: 'Second returned leaf'}}],
    ['missing-read', {missing: null}]
];
const result = label => ['Application\\Blog\\Model\\JournalFrontendPreference', label, '1', 'warm-plugin'];
const query = encodeURIComponent('query MageLensAreaProbe { mageLensAreaProbe }');
const apiJourneys = [
    ['/rest/default/V1/magelens/area-probe', result('REST label')],
    ['/graphql?operationName=MageLensAreaProbe&query=' + query, {data: {mageLensAreaProbe: result('GraphQL label')}}]
];
const routingJourneys = [
    ['GET', '/blog/index/routeprobe', 200, {winner: 'competing-module'}],
    ['GET', '/coverageprobe/index/catalogue', 200, {route: 'coverageprobe'}],
    ['GET', '/catalogue/index/catalogue', 200, {route: 123}],
    ['GET', '/catalogue/index/catalogue?rewrite=1', 200, {route: '0123'}],
    ['GET', '/alternatecatalogue/index/catalogue', 200, {route: '0123'}],
    ['GET', '/350/index/catalogue', 200, {route: 'collisionwinner'}],
    ['GET', '/rest/default/V1/magelens/area-probe/free', 200, [...result('REST label'), 'variable-route']],
    ['GET', '/rest/default/V1/magelens/area-probe/cached', 200, ['cached-response']],
    ['GET', '/rest/default/V1/magelens/area-probe/restricted', 401],
    ['PUT', '/rest/default/V1/magelens/area-probe', 404]
];
module.exports = {journeys, apiJourneys, routingJourneys};
