// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use serde::Serialize;

// Manually maintained, NOT updated at runtime. Reference measurements and their
// limits below. Changing these requires a rebuild.
// One unit is one reviewed awaited browser operation/assertion in source;
// constructors and locator construction are not units. Helper bodies need an
// adapter estimate. This is an indicative Playwright baseline, not Cypress.
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Baseline {
    pub version: &'static str,
    pub unit_ms: f64,
    pub capture_ms: f64,
    pub restore_ms: f64,
    pub release_ms: f64,
    pub reset_ms: f64,
    pub overhead_margin: f64,
    pub min_saving_ms: f64,
}

pub const PLAYWRIGHT_BRANCHING: Baseline = Baseline {
    version: "pw1.65-branching-http-fixture-2026-11-07-v1",
    unit_ms: 40.0,
    capture_ms: 1000.0,
    restore_ms: 3800.0,
    release_ms: 11.0,
    reset_ms: 1100.0,
    overhead_margin: 0.20,
    min_saving_ms: 50.0,
};
