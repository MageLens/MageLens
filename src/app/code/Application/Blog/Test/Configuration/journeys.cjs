// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Shared real HTTP expectations for both pinned browser runners.
const journeys = [
    ['baseline', {}],
    ['default-read', {heading: 'Journal'}],
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
module.exports = {journeys};
