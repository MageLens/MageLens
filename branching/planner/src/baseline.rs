// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use serde::Serialize;

// Manually maintained, NOT updated at runtime. Reference measurements and their
// limits below. Changing these requires a rebuild.
// Native repeated checkout prefixes: about 1.0 s / 9 reviewed units and
// 6.2-7.1 s / 47 units. Use 125 ms/unit, excluding worker-scoped login.
// Three retained-service qualifications: median capture 4.01 s, restore 8.44 s,
// first reset 16.77 s, prepare + cleanup about 16.1 s, release 11 ms.
// Later uncached resets use the rounded upper observed restore (9.74 s).
// Small local sample: estimates, not hardware-independent guarantees. Native
// Playwright does not reset the database between tests. Prefetch is not assumed
// to hide imports: it depends on suffix length and must not fabricate savings.
// Source weights in points.rs now express operations in 125 ms points. Those
// weights are static heuristics, not separately measured operation timings.
// The measured checkpoint overheads above are unchanged; forecasts need
// validation against representative suites before changing these constants.
// This is an indicative Playwright baseline, not Cypress.
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Baseline {
    pub version: &'static str,
    pub unit_ms: f64,
    pub capture_ms: f64,
    pub restore_ms: f64,
    pub release_ms: f64,
    pub reset_ms: f64,
    pub first_reset_ms: f64,
    pub backend_ms: f64,
    pub overhead_margin: f64,
    pub min_saving_ms: f64,
}

pub const PLAYWRIGHT_BRANCHING: Baseline = Baseline {
    version: "pw1.65-retained-points-2026-11-07-v3",
    unit_ms: 125.0,
    capture_ms: 4100.0,
    restore_ms: 8500.0,
    release_ms: 11.0,
    reset_ms: 10000.0,
    first_reset_ms: 17000.0,
    backend_ms: 16200.0,
    overhead_margin: 0.20,
    min_saving_ms: 50.0,
};
